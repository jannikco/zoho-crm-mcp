/** Native OS credential stores only. Secrets travel over stdin, never process arguments or logs. */
import { spawn } from 'node:child_process';
const SERVICE = 'integration-factory';
function account(id) { if (!/^[a-z0-9][a-z0-9-]{0,99}$/.test(id)) throw new Error('Invalid credential account'); return id; }
export function runNative(command, args, { input = '', timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const output = []; let bytes = 0, settled = false;
    const timer = setTimeout(() => { child.kill(); fail(); }, timeoutMs);
    function fail() { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Native credential store unavailable or access denied; use process environment credentials instead')); } }
    child.on('error', fail); child.stdin.on('error', () => {});
    child.stdout.on('data', data => { bytes += data.length; if (bytes > 262144) { child.kill(); fail(); } else output.push(data); });
    child.stderr.on('data', () => {}); // Native messages can echo a secret. Never forward them.
    child.on('close', code => { if (settled) return; if (code !== 0) return fail(); settled = true; clearTimeout(timer); resolve(Buffer.concat(output).toString('utf8').trim()); });
    child.stdin.end(input);
  });
}
const WINDOWS_SCRIPT = `
Add-Type @'
using System; using System.Runtime.InteropServices;
public class NativeCredentials {
[StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL { public UInt32 Flags,Type; public string TargetName,Comment; public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist,AttributeCount; public IntPtr Attributes; public string TargetAlias,UserName; }
[DllImport("advapi32.dll",EntryPoint="CredWriteW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Write(ref CREDENTIAL c,UInt32 f);
[DllImport("advapi32.dll",EntryPoint="CredReadW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Read(string t,UInt32 y,UInt32 f,out IntPtr p);
[DllImport("advapi32.dll",EntryPoint="CredDeleteW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Delete(string t,UInt32 y,UInt32 f);
[DllImport("advapi32.dll")] public static extern void CredFree(IntPtr p);
}
'@
$p = [Console]::In.ReadToEnd() | ConvertFrom-Json
$t = "integration-factory/" + $p.account
if ($p.operation -eq 'save') {
 $b=[Text.Encoding]::UTF8.GetBytes([string]$p.value); $m=[Runtime.InteropServices.Marshal]::AllocHGlobal($b.Length)
 try { [Runtime.InteropServices.Marshal]::Copy($b,0,$m,$b.Length); $c=New-Object NativeCredentials+CREDENTIAL; $c.Type=1; $c.TargetName=$t; $c.UserName=$p.account; $c.Persist=2; $c.CredentialBlobSize=$b.Length; $c.CredentialBlob=$m; if(-not [NativeCredentials]::Write([ref]$c,0)){exit 1} } finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($m) }
} elseif ($p.operation -eq 'load') {
 $m=[IntPtr]::Zero; if(-not [NativeCredentials]::Read($t,1,0,[ref]$m)){exit 1}
 try { $c=[Runtime.InteropServices.Marshal]::PtrToStructure($m,[type][NativeCredentials+CREDENTIAL]); $b=New-Object byte[] $c.CredentialBlobSize; [Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob,$b,0,$b.Length); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($b)) } finally { [NativeCredentials]::CredFree($m) }
} elseif ($p.operation -eq 'delete') { if(-not [NativeCredentials]::Delete($t,1,0)){exit 1} }
`;
export function createCredentialStore({ platform = process.platform, run = runNative } = {}) {
  async function operation(op, id, value) {
    account(id);
    if (platform === 'darwin') {
      if (op === 'save') {
        // security's interactive command parser accepts the secret on stdin, avoiding insecure -w argv values.
        const encoded = Buffer.from(value).toString('base64');
        await run('security', ['-i'], { input: `add-generic-password -U -s "${SERVICE}" -a "${id}" -w "${encoded}"\n` }); return;
      }
      if (op === 'delete') { await run('security', ['delete-generic-password', '-s', SERVICE, '-a', id]); return; }
      const encoded = await run('security', ['find-generic-password', '-s', SERVICE, '-a', id, '-w']);
      return Buffer.from(encoded, 'base64').toString('utf8');
    }
    if (platform === 'linux') {
      const lookup = ['service', SERVICE, 'account', id];
      if (op === 'save') { await run('secret-tool', ['store', '--label=Integration Factory OAuth', ...lookup], { input: value }); return; }
      return run('secret-tool', [op === 'load' ? 'lookup' : 'clear', ...lookup]);
    }
    if (platform === 'win32') return run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SCRIPT], { input: JSON.stringify({ operation: op, account: id, ...(value ? { value } : {}) }) });
    throw new Error('No supported native credential store; use process environment credentials');
  }
  return {
    async save(id, record) { const value = JSON.stringify(record); if (Buffer.byteLength(value) > (platform === 'win32' ? 2400 : 65536)) throw new Error('Credential record exceeds native store limit'); await operation('save', id, value); const stored = await operation('load', id); if (stored !== value) throw new Error('Native credential storage could not be verified'); },
    async load(id) { const value = await operation('load', id); try { return JSON.parse(value); } catch { throw new Error('Native credential record is invalid'); } },
    async delete(id) { await operation('delete', id); },
  };
}

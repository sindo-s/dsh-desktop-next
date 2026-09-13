param([int]$TestProcessId,[int]$Width=980,[int]$Height=740)
$ErrorActionPreference='Stop'
$testProcess=Get-Process -Id $TestProcessId
if([IO.Path]::GetFileName($testProcess.Path) -ne 'dsh-desktop-next.exe'){throw 'Not the desktop test process'}
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class DshWindowTest {
  [DllImport("user32.dll",SetLastError=true)]
  public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int width,int height,uint flags);
}
'@
if($testProcess.MainWindowHandle -eq [IntPtr]::Zero){throw 'Test window is not ready'}
if(-not [DshWindowTest]::SetWindowPos($testProcess.MainWindowHandle,[IntPtr]::Zero,0,0,$Width,$Height,22)){throw 'Window resize failed'}

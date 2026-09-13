param([int]$Samples=6)
$ErrorActionPreference='Stop'
$oldPath='D:\dsh\DeepSeek-Harness\DeepSeek-Harness.exe'
$newPath='D:\DSH-Next\app\dsh-desktop-next.exe'
$data=@()
for($i=0;$i -lt $Samples;$i++) {
    $all=Get-CimInstance Win32_Process
    foreach($entry in @(@{name='Electron';path=$oldPath},@{name='Tauri';path=$newPath})) {
        $ids=[System.Collections.Generic.HashSet[int]]::new()
        foreach($p in $all){if($p.ExecutablePath -eq $entry.path){[void]$ids.Add([int]$p.ProcessId)}}
        if($ids.Count -eq 0){throw "$($entry.name) is not running; start both applications in the same UI state first"}
        do{$before=$ids.Count;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}}}while($ids.Count -gt $before)
        $processes=Get-Process -Id @($ids) -ErrorAction SilentlyContinue
        $data+=[PSCustomObject]@{name=$entry.name;sample=$i;processes=$processes.Count;privateMB=[math]::Round(($processes|Measure-Object PrivateMemorySize64 -Sum).Sum/1MB,1);workingSetMB=[math]::Round(($processes|Measure-Object WorkingSet64 -Sum).Sum/1MB,1);cpuSeconds=[math]::Round(($processes|Measure-Object CPU -Sum).Sum,2)}
    }
    Start-Sleep -Seconds 2
}
$data | ConvertTo-Json

# Render with a new, hidden Word instance; never attach to an existing one.
param([Parameter(Mandatory=$true)][string]$InputDocx)
$ErrorActionPreference='Stop'
$docxPath=[IO.Path]::GetFullPath($InputDocx)
if(-not (Test-Path -LiteralPath $docxPath)){throw 'Input DOCX does not exist'}
$pdfPath=[IO.Path]::ChangeExtension($docxPath,'.pdf')
$word=$null;$document=$null
try {
    $word=New-Object -ComObject Word.Application
    $word.Visible=$false
    $word.DisplayAlerts=0
    $word.AutomationSecurity=3
    $document=$word.Documents.Open($docxPath,$false,$true)
    $document.Repaginate()
    $document.ExportAsFixedFormat($pdfPath,17)
    $pages=$document.ComputeStatistics(2)
    Write-Output "Exported $pdfPath ($pages pages) through Microsoft Word"
} finally {
    if($null -ne $document){
        try{$document.Close(0)}catch{Write-Verbose "Document already disconnected during cleanup: $($_.Exception.Message)"}
        try{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($document)}catch{}
    }
    if($null -ne $word){
        try{$word.Quit(0)}catch{Write-Verbose "Owned Word instance already disconnected: $($_.Exception.Message)"}
        try{[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($word)}catch{}
    }
}

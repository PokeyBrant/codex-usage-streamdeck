param(
    [string] $OutputDir = (Join-Path $PSScriptRoot "..\marketplace-assets")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

function New-Bitmap($path, [scriptblock] $draw) {
    $bmp = [System.Drawing.Bitmap]::new(1920, 960)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $draw.Invoke($g)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

function Brush($hex) {
    [System.Drawing.SolidBrush]::new([System.Drawing.ColorTranslator]::FromHtml($hex))
}

function Pen($hex, $width) {
    $p = [System.Drawing.Pen]::new([System.Drawing.ColorTranslator]::FromHtml($hex), $width)
    $p.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $p.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    $p
}

function Font($size, $style = [System.Drawing.FontStyle]::Regular) {
    [System.Drawing.Font]::new("Arial", $size, $style, [System.Drawing.GraphicsUnit]::Pixel)
}

function Text($g, $text, $x, $y, $size, $color, $style = [System.Drawing.FontStyle]::Regular, $align = "Near") {
    $font = Font $size $style
    $brush = Brush $color
    $format = [System.Drawing.StringFormat]::new()
    if ($align -eq "Center") { $format.Alignment = [System.Drawing.StringAlignment]::Center }
    if ($align -eq "Far") { $format.Alignment = [System.Drawing.StringAlignment]::Far }
    $g.DrawString($text, $font, $brush, [System.Drawing.PointF]::new($x, $y), $format)
    $font.Dispose()
    $brush.Dispose()
    $format.Dispose()
}

function TextBox($g, $text, $x, $y, $w, $h, $size, $color, $style = [System.Drawing.FontStyle]::Regular, $align = "Near") {
    $font = Font $size $style
    $brush = Brush $color
    $format = [System.Drawing.StringFormat]::new()
    $format.Trimming = [System.Drawing.StringTrimming]::EllipsisWord
    if ($align -eq "Center") { $format.Alignment = [System.Drawing.StringAlignment]::Center }
    if ($align -eq "Far") { $format.Alignment = [System.Drawing.StringAlignment]::Far }
    $rect = [System.Drawing.RectangleF]::new($x, $y, $w, $h)
    $g.DrawString($text, $font, $brush, $rect, $format)
    $font.Dispose()
    $brush.Dispose()
    $format.Dispose()
}

function RoundRectPath($x, $y, $w, $h, $r) {
    $path = [System.Drawing.Drawing2D.GraphicsPath]::new()
    $d = $r * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $path
}

function FillRound($g, $x, $y, $w, $h, $r, $color) {
    $brush = Brush $color
    if ($r -le 0) {
        $g.FillRectangle($brush, $x, $y, $w, $h)
        $brush.Dispose()
        return
    }
    $path = RoundRectPath $x $y $w $h $r
    $g.FillPath($brush, $path)
    $brush.Dispose()
    $path.Dispose()
}

function GradientBackground($g, $left, $right) {
    $rect = [System.Drawing.Rectangle]::new(0, 0, 1920, 960)
    $brush = [System.Drawing.Drawing2D.LinearGradientBrush]::new(
        $rect,
        [System.Drawing.ColorTranslator]::FromHtml($left),
        [System.Drawing.ColorTranslator]::FromHtml($right),
        [System.Drawing.Drawing2D.LinearGradientMode]::ForwardDiagonal
    )
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()
    $vignette = Brush "#000000"
    $state = $g.Save()
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
    $g.FillRectangle([System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(80, 0, 0, 0)), 0, 0, 1920, 960)
    $g.Restore($state)
    $vignette.Dispose()
}

function Detail($g, $label, $value, $x, $y) {
    Text $g $label $x $y 25 "#95a3b5" ([System.Drawing.FontStyle]::Bold)
    Text $g $value $x ($y+38) 34 "#f7fbff" ([System.Drawing.FontStyle]::Bold)
}

function Pill($g, $text, $x, $y, $w, $color) {
    FillRound $g $x $y $w 50 25 $color
    Text $g $text ($x + ($w / 2)) ($y + 11) 24 "#07120d" ([System.Drawing.FontStyle]::Bold) "Center"
}

function DrawAppIcon($g, $x, $y, $size) {
    FillRound $g $x $y $size $size ($size*.22) "#111a25"
    $stroke = Pen "#2b3a4b" ($size*.055)
    $g.DrawPath($stroke, (RoundRectPath ($x+$size*.1) ($y+$size*.1) ($size*.8) ($size*.8) ($size*.17)))
    $stroke.Dispose()
    $green = Pen "#34e977" ($size*.08)
    $g.DrawLine($green, $x+$size*.28, $y+$size*.38, $x+$size*.72, $y+$size*.38)
    $g.DrawLine($green, $x+$size*.28, $y+$size*.64, $x+$size*.72, $y+$size*.64)
    $green.Dispose()
    Text $g "5H" ($x+$size*.5) ($y+$size*.22) ($size*.17) "#f7fbff" ([System.Drawing.FontStyle]::Bold) "Center"
    Text $g "WK" ($x+$size*.5) ($y+$size*.48) ($size*.17) "#f7fbff" ([System.Drawing.FontStyle]::Bold) "Center"
}

function DrawBarKey($g, $x, $y, $scale, $five, $week, $level = "green") {
    $lowest = [Math]::Min($five, $week)
    $panelLevel = if ($lowest -le 10) { "critical" } elseif ($lowest -le 20) { "red" } elseif ($lowest -le 50) { "yellow" } else { $level }
    $fiveAccent = if ($five -le 10) { "#ff335d" } elseif ($five -le 20) { "#ffb020" } elseif ($five -le 50) { "#f6d84d" } else { "#34e977" }
    $weekAccent = if ($week -le 10) { "#ff335d" } elseif ($week -le 20) { "#ffb020" } elseif ($week -le 50) { "#f6d84d" } else { "#34e977" }
    $panel = if ($panelLevel -eq "critical") { "#1d1421" } elseif ($panelLevel -eq "red") { "#1b1624" } elseif ($panelLevel -eq "yellow") { "#181b25" } else { "#111a25" }
    FillRound $g $x $y (300*$scale) (300*$scale) (52*$scale) $panel
    Text $g "$five%" ($x+48*$scale) ($y+55*$scale) (58*$scale) "#f6fff8" ([System.Drawing.FontStyle]::Bold)
    Text $g "5H" ($x+230*$scale) ($y+41*$scale) (38*$scale) $fiveAccent ([System.Drawing.FontStyle]::Bold) "Center"
    Text $g "30m · R1" ($x+227*$scale) ($y+91*$scale) (22*$scale) "#f6fff8" ([System.Drawing.FontStyle]::Bold) "Center"
    $track = Pen "#263241" (14*$scale)
    $pen = Pen $fiveAccent (14*$scale)
    $g.DrawLine($track, $x+50*$scale, $y+140*$scale, $x+247*$scale, $y+140*$scale)
    $g.DrawLine($pen, $x+50*$scale, $y+140*$scale, $x+(50+1.97*$five)*$scale, $y+140*$scale)
    Text $g "$week%" ($x+48*$scale) ($y+178*$scale) (58*$scale) "#f6fff8" ([System.Drawing.FontStyle]::Bold)
    Text $g "WK" ($x+230*$scale) ($y+164*$scale) (38*$scale) $weekAccent ([System.Drawing.FontStyle]::Bold) "Center"
    Text $g "6d" ($x+230*$scale) ($y+214*$scale) (32*$scale) "#f6fff8" ([System.Drawing.FontStyle]::Bold) "Center"
    $g.DrawLine($track, $x+50*$scale, $y+265*$scale, $x+247*$scale, $y+265*$scale)
    $pen.Dispose()
    $pen = Pen $weekAccent (14*$scale)
    $g.DrawLine($pen, $x+50*$scale, $y+265*$scale, $x+(50+1.97*$week)*$scale, $y+265*$scale)
    $track.Dispose()
    $pen.Dispose()
}

function DrawRingKey($g, $x, $y, $scale, $value, $level = "green") {
    $accent = if ($level -eq "red") { "#ff335d" } elseif ($level -eq "yellow") { "#f6d84d" } else { "#34e977" }
    FillRound $g $x $y (300*$scale) (300*$scale) (52*$scale) "#111a25"
    $track = Pen "#263241" (22*$scale)
    $pen = Pen $accent (22*$scale)
    $rect = [System.Drawing.RectangleF]::new($x+54*$scale, $y+54*$scale, 192*$scale, 192*$scale)
    $g.DrawArc($track, $rect, 145, 250)
    $g.DrawArc($pen, $rect, 145, 250*($value/100))
    Text $g "$value%" ($x+150*$scale) ($y+112*$scale) (56*$scale) "#f6fff8" ([System.Drawing.FontStyle]::Bold) "Center"
    Text $g "5H" ($x+150*$scale) ($y+169*$scale) (33*$scale) "#f6fff8" ([System.Drawing.FontStyle]::Bold) "Center"
    Text $g "30m · R1" ($x+150*$scale) ($y+224*$scale) (28*$scale) "#f6fff8" ([System.Drawing.FontStyle]::Bold) "Center"
    $track.Dispose()
    $pen.Dispose()
}

function DrawWarningKey($g, $x, $y, $scale, $value = 8, $label = "5 Hours", $duration = "46 min", $clock = "10:00 PM", $level = "red") {
    $accent = if ($level -eq "green") { "#34e977" } elseif ($level -eq "yellow") { "#f6d84d" } else { "#ff335d" }
    $panel = if ($level -eq "green") { "#111a25" } elseif ($level -eq "yellow") { "#181b25" } else { "#1d1421" }
    $trackColor = if ($level -eq "green") { "#263241" } elseif ($level -eq "yellow") { "#333640" } else { "#34303f" }
    FillRound $g $x $y (300*$scale) (300*$scale) (52*$scale) $panel
    Text $g $label ($x+150*$scale) ($y+36*$scale) (40*$scale) $accent ([System.Drawing.FontStyle]::Bold) "Center"
    Text $g "$value%" ($x+150*$scale) ($y+70*$scale) (96*$scale) "#fff8fb" ([System.Drawing.FontStyle]::Bold) "Center"
    $track = Pen $trackColor (18*$scale)
    $pen = Pen $accent (18*$scale)
    $g.DrawLine($track, $x+63*$scale, $y+190*$scale, $x+237*$scale, $y+190*$scale)
    $g.DrawLine($pen, $x+63*$scale, $y+190*$scale, $x+(63+[Math]::Max(10, $value*1.74))*$scale, $y+190*$scale)
    Text $g $duration ($x+150*$scale) ($y+210*$scale) (32*$scale) "#fff8fb" ([System.Drawing.FontStyle]::Bold) "Center"
    Text $g $clock ($x+150*$scale) ($y+251*$scale) (27*$scale) "#fff8fb" ([System.Drawing.FontStyle]::Bold) "Center"
    $track.Dispose()
    $pen.Dispose()
}

function DrawResetDetailsKey($g, $x, $y, $scale) {
    FillRound $g $x $y (300*$scale) (300*$scale) (52*$scale) "#071312"
    FillRound $g ($x+21*$scale) ($y+21*$scale) (258*$scale) (258*$scale) (46*$scale) "#111a25"
    Text $g "R1" ($x+150*$scale) ($y+54*$scale) (118*$scale) "#f6fff8" ([System.Drawing.FontStyle]::Bold) "Center"
    Text $g "EXPIRES" ($x+150*$scale) ($y+192*$scale) (22*$scale) "#34e977" ([System.Drawing.FontStyle]::Bold) "Center"
    Text $g "SEP 20" ($x+150*$scale) ($y+218*$scale) (46*$scale) "#34e977" ([System.Drawing.FontStyle]::Bold) "Center"
}

function DrawSplitKey($g, $x, $y, $scale, $five, $week) {
    FillRound $g $x $y (300*$scale) (300*$scale) (52*$scale) "#071312"
    FillRound $g ($x+22*$scale) ($y+22*$scale) (256*$scale) (116*$scale) (34*$scale) "#111a25"
    FillRound $g ($x+22*$scale) ($y+162*$scale) (256*$scale) (116*$scale) (34*$scale) "#111a25"
    Text $g "5H" ($x+58*$scale) ($y+51*$scale) (33*$scale) "#34e977" ([System.Drawing.FontStyle]::Bold)
    Text $g "$five%" ($x+58*$scale) ($y+90*$scale) (55*$scale) "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    Text $g "R1" ($x+244*$scale) ($y+51*$scale) (32*$scale) "#ffffff" ([System.Drawing.FontStyle]::Bold) "Far"
    Text $g "WK" ($x+58*$scale) ($y+191*$scale) (33*$scale) "#f6d84d" ([System.Drawing.FontStyle]::Bold)
    Text $g "$week%" ($x+58*$scale) ($y+230*$scale) (55*$scale) "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    Text $g "6d" ($x+244*$scale) ($y+191*$scale) (36*$scale) "#ffffff" ([System.Drawing.FontStyle]::Bold) "Far"
}

function DrawInspectorField($g, $label, $value, $x, $y, $scale, $kind = "select") {
    Text $g $label $x ($y+11*$scale) (17*$scale) "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    FillRound $g ($x+245*$scale) $y (342*$scale) (42*$scale) (6*$scale) "#090d13"
    $border = Pen "#354254" (1.2*$scale)
    $g.DrawPath($border, (RoundRectPath ($x+245*$scale) $y (342*$scale) (42*$scale) (6*$scale)))
    $border.Dispose()
    Text $g $value ($x+263*$scale) ($y+10*$scale) (16*$scale) "#ffffff" ([System.Drawing.FontStyle]::Bold)
    if ($kind -eq "select") {
        Text $g "v" ($x+565*$scale) ($y+8*$scale) (18*$scale) "#ffffff" ([System.Drawing.FontStyle]::Bold) "Center"
    }
}

function DrawInspectorCheckbox($g, $label, $x, $y, $scale, $checked = $true) {
    Text $g $label $x ($y+5*$scale) (16*$scale) "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    FillRound $g ($x+475*$scale) $y (26*$scale) (26*$scale) (4*$scale) "#d8e8fb"
    if ($checked) {
        Text $g "/" ($x+488*$scale) ($y-5*$scale) (35*$scale) "#2f6f9e" ([System.Drawing.FontStyle]::Bold) "Center"
    }
}

function DrawInspector($g, $x, $y, $scale) {
    FillRound $g $x $y (820*$scale) (782*$scale) (10*$scale) "#2a2a2a"
    FillRound $g $x ($y+58*$scale) (170*$scale) (724*$scale) 0 "#2f2f2f"
    Text $g "Codex Usage Monitor:" ($x+16*$scale) ($y+15*$scale) (18*$scale) "#ffffff" ([System.Drawing.FontStyle]::Bold)
    Text $g "Codex Usage" ($x+210*$scale) ($y+15*$scale) (18*$scale) "#ffffff"
    Text $g "?" ($x+724*$scale) ($y+10*$scale) (26*$scale) "#9ca3af" ([System.Drawing.FontStyle]::Bold) "Center"
    Text $g "[]" ($x+786*$scale) ($y+12*$scale) (20*$scale) "#9ca3af" ([System.Drawing.FontStyle]::Bold) "Center"
    $rule = Pen "#464646" (1*$scale)
    $g.DrawLine($rule, $x+16*$scale, $y+58*$scale, $x+798*$scale, $y+58*$scale)
    $rule.Dispose()

    DrawBarKey $g ($x+18*$scale) ($y+86*$scale) (.37*$scale) 46 83 "yellow"

    Text $g "Title:" ($x+252*$scale) ($y+94*$scale) (17*$scale) "#cfd3dc" "Regular" "Far"
    FillRound $g ($x+270*$scale) ($y+82*$scale) (392*$scale) (42*$scale) 0 "#2d2d2d"
    Text $g "Disabled" ($x+292*$scale) ($y+94*$scale) (17*$scale) "#9aa3ad"
    Text $g "T" ($x+686*$scale) ($y+89*$scale) (24*$scale) "#a9a9a9" ([System.Drawing.FontStyle]::Bold)
    Text $g "v" ($x+724*$scale) ($y+91*$scale) (16*$scale) "#a9a9a9" ([System.Drawing.FontStyle]::Bold)

    $mainX = $x + 210*$scale
    FillRound $g $mainX ($y+78*$scale) (588*$scale) (118*$scale) (10*$scale) "#111821"
    $statusBorder = Pen "#32465c" (1.4*$scale)
    $g.DrawPath($statusBorder, (RoundRectPath $mainX ($y+78*$scale) (588*$scale) (118*$scale) (10*$scale)))
    $statusBorder.Dispose()
    $dot = Brush "#34e977"
    $g.FillEllipse($dot, $mainX+18*$scale, $y+96*$scale, 12*$scale, 12*$scale)
    $dot.Dispose()
    Text $g "Usage data current" ($mainX+42*$scale) ($y+91*$scale) (18*$scale) "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    Text $g "Banked resets" ($mainX+20*$scale) ($y+130*$scale) (15*$scale) "#95a3b5" ([System.Drawing.FontStyle]::Bold)
    Text $g "2" ($mainX+20*$scale) ($y+153*$scale) (24*$scale) "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    Text $g "Current usage" ($mainX+180*$scale) ($y+130*$scale) (15*$scale) "#95a3b5" ([System.Drawing.FontStyle]::Bold)
    Text $g "No reset needed" ($mainX+180*$scale) ($y+153*$scale) (17*$scale) "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    Text $g "Expires" ($mainX+410*$scale) ($y+130*$scale) (15*$scale) "#95a3b5" ([System.Drawing.FontStyle]::Bold)
    Text $g "Sep 20, 8:25 PM" ($mainX+410*$scale) ($y+153*$scale) (16*$scale) "#f7fbff" ([System.Drawing.FontStyle]::Bold)

    Text $g "DISPLAY" $mainX ($y+220*$scale) (20*$scale) "#9fc2e6" ([System.Drawing.FontStyle]::Bold)
    DrawInspectorField $g "Mode" "Warning tile" $mainX ($y+252*$scale) $scale "select"
    DrawInspectorField $g "Percent" "Remaining" $mainX ($y+302*$scale) $scale "select"
    DrawInspectorField $g "Single icon shows" "Weekly" $mainX ($y+352*$scale) $scale "select"
    DrawInspectorCheckbox $g "Show reset time" $mainX ($y+405*$scale) $scale $true
    DrawInspectorCheckbox $g "Show banked resets" $mainX ($y+441*$scale) $scale $true
    DrawInspectorCheckbox $g "Use 24-hour time" $mainX ($y+477*$scale) $scale $true

    Text $g "REMAINING THRESHOLDS" $mainX ($y+528*$scale) (20*$scale) "#9fc2e6" ([System.Drawing.FontStyle]::Bold)
    Text $g "Colors always use remaining capacity." $mainX ($y+556*$scale) (14*$scale) "#95a3b5"
    $fieldW = 174*$scale
    $gap = 14*$scale
    $startY = $y + 584*$scale
    $labels = @("Yellow at", "Red at", "Critical at")
    $values = @("50", "20", "10")
    for ($i=0; $i -lt 3; $i++) {
        $fx = $mainX + ($i * ($fieldW + $gap))
        Text $g $labels[$i] $fx $startY (15*$scale) "#ffffff" ([System.Drawing.FontStyle]::Bold)
        FillRound $g $fx ($startY+28*$scale) $fieldW (40*$scale) (6*$scale) "#090d13"
        $inputBorder = Pen "#354254" (1.2*$scale)
        $g.DrawPath($inputBorder, (RoundRectPath $fx ($startY+28*$scale) $fieldW (40*$scale) (6*$scale)))
        $inputBorder.Dispose()
        Text $g $values[$i] ($fx+16*$scale) ($startY+39*$scale) (16*$scale) "#ffffff" ([System.Drawing.FontStyle]::Bold)
    }

    Text $g "UPDATES" $mainX ($y+675*$scale) (20*$scale) "#9fc2e6" ([System.Drawing.FontStyle]::Bold)
    Text $g "Refresh seconds" $mainX ($y+716*$scale) (16*$scale) "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    FillRound $g ($mainX+245*$scale) ($y+706*$scale) (160*$scale) (40*$scale) (6*$scale) "#090d13"
    Text $g "300" ($mainX+263*$scale) ($y+716*$scale) (16*$scale) "#ffffff" ([System.Drawing.FontStyle]::Bold)
    FillRound $g ($mainX+420*$scale) ($y+706*$scale) (168*$scale) (40*$scale) (6*$scale) "#20352f"
    Text $g "Refresh Now" ($mainX+504*$scale) ($y+716*$scale) (15*$scale) "#34e977" ([System.Drawing.FontStyle]::Bold) "Center"
}

New-Bitmap (Join-Path $OutputDir "thumbnail-1920x960.png") {
    param($g)
    GradientBackground $g "#061412" "#13273f"
    DrawAppIcon $g 118 112 160
    Text $g "Codex Usage Monitor" 118 330 82 "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    TextBox $g "Track Codex usage and banked resets on Stream Deck." 122 430 820 98 36 "#b8c4d4"
    Pill $g "FREE" 122 552 118 "#34e977"
    Pill $g "LOCAL AUTH" 262 552 210 "#9ee7ff"
    Detail $g "Banked reset" "R1 · expires Sep 20" 122 660
    Detail $g "Usage windows" "5-hour · Week · Spark" 122 775
    DrawBarKey $g 1030 130 1.34 46 83 "yellow"
    DrawSplitKey $g 1392 290 .82 46 83
    DrawWarningKey $g 1086 610 .72 83 "Week" "1 day · R1" "22:00" "green"
    DrawRingKey $g 1390 585 .76 46 "yellow"
    DrawResetDetailsKey $g 1602 603 .56
}

New-Bitmap (Join-Path $OutputDir "gallery-dual-bars-green.png") {
    param($g)
    GradientBackground $g "#061412" "#1f3140"
    Text $g "See both limits at a glance" 120 120 70 "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    TextBox $g "Dual bars keep both main quota windows visible and show R1 once whenever a reset is banked." 124 216 820 110 34 "#b8c4d4"
    Detail $g "5H" "46% remaining · 30m · R1" 124 355
    Detail $g "WK" "83% remaining · 4d" 124 485
    Pill $g "One clear reset indicator" 124 650 332 "#34e977"
    DrawBarKey $g 1070 155 1.62 46 83 "yellow"
}

New-Bitmap (Join-Path $OutputDir "gallery-ring-warning.png") {
    param($g)
    GradientBackground $g "#0b1018" "#343014"
    Text $g "Single-window views" 120 120 70 "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    TextBox $g "Ring and Warning Tile can focus on Auto, 5-hour, Week, or Spark while keeping a banked reset visible." 124 216 850 118 34 "#cbd3df"
    Detail $g "Banked resets" "2 available" 124 370
    Detail $g "Current usage" "1 can apply now" 124 500
    Pill $g "12 or 24-hour clock" 124 670 306 "#f6d84d"
    DrawRingKey $g 1030 210 1.12 46 "yellow"
    DrawWarningKey $g 1410 210 1.12 83 "Week" "1 day · R1" "22:00" "green"
}

New-Bitmap (Join-Path $OutputDir "gallery-critical-state.png") {
    param($g)
    GradientBackground $g "#100b14" "#3b1322"
    Text $g "Critical state stays readable" 120 120 70 "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    TextBox $g "Threshold colors always use remaining capacity, with optional flicker and exact reset timing." 124 216 820 110 34 "#d8c6d3"
    Detail $g "Critical threshold" "10% remaining" 124 360
    Detail $g "Visual flicker" "Configurable by level" 124 490
    Pill $g "Cached visual updates" 124 654 292 "#ff9db3"
    DrawWarningKey $g 1100 150 1.58 8 "5 Hours" "46 min" "10:00 PM" "red"
}

New-Bitmap (Join-Path $OutputDir "gallery-property-inspector.png") {
    param($g)
    GradientBackground $g "#0b1018" "#183833"
    Text $g "Reset status, clearly" 120 120 70 "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    TextBox $g "See refresh state, banked resets, current-usage applicability, and expiration in one status card." 124 216 780 112 34 "#b8c4d4"
    Detail $g "Reset status" "2 banked · no reset needed" 124 370
    Detail $g "Visual changes" "Rerender cached usage" 124 500
    Pill $g "Property Inspector" 124 670 300 "#34e977"
    DrawInspector $g 885 98 .92
}

New-Bitmap (Join-Path $OutputDir "gallery-reset-details.png") {
    param($g)
    GradientBackground $g "#061412" "#17302a"
    Text $g "Reset details, display-only" 120 120 70 "#f7fbff" ([System.Drawing.FontStyle]::Bold)
    TextBox $g "See the banked reset count and expiration date at a glance. Pressing the key only refreshes the data." 124 216 860 122 34 "#b8c4d4"
    Detail $g "Reset count" "R1" 124 382
    Detail $g "Expiration" "Sep 20" 124 512
    Pill $g "Never applies a reset" 124 682 318 "#34e977"
    DrawResetDetailsKey $g 1120 170 1.75
}

Get-ChildItem -LiteralPath $OutputDir -Filter *.png | Select-Object FullName, Length

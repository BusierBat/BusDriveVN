import re
with open(r'X:\Documents\PentiumStudio\CoachVN-Source-main-main\CoachVN-Source-main-main\js\ui.js', 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r"ctx\.fillText\(f'\{scaleKm\}m', 5, 195\)\;", r"ctx.fillText(scaleKm + 'm', 5, 195);", content)

with open(r'X:\Documents\PentiumStudio\CoachVN-Source-main-main\CoachVN-Source-main-main\js\ui.js', 'w', encoding='utf-8') as f:
    f.write(content)
print('Fixed!')
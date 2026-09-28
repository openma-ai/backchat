from pathlib import Path
import json, math, xml.etree.ElementTree as ET
repo=Path(__file__).resolve().parents[2]
root=repo/'artifacts/icons'
root.mkdir(parents=True, exist_ok=True)
P=lambda d:f'<path d="{d}"/>'
C=lambda x,y,r:f'<circle cx="{x}" cy="{y}" r="{r}"/>'
R=lambda x,y,w,h,r=2:f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}"/>'
icons={}
def add(name,label,use,body):icons[name]={'label':label,'use':use,'body':body}
add('folder-closed','文件夹 · 收起','项目分组收起',P('M3 8V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm0 1h18'))
add('folder-open','文件夹 · 展开','项目分组展开',P('M3 18V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2M3 19l3-8h16l-3 9H5a2 2 0 0 1-2-1Z'))
add('compose','新建对话','固定顶部新建对话',P('M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4')+P('m10 11 8-8a1.4142135624 1.4142135624 0 0 1 2 2l-8 8-3 1 1-3Z'))
add('search','搜索','固定顶部搜索',C(10.5,10.5,6)+P('m15 15 4.5 4.5'))
add('chat','对话','对话分组与普通会话',P('M6 4h12a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H9l-4 3v-3a3 3 0 0 1-2-3V7a3 3 0 0 1 3-3Z'))
add('coordination','编排','多 Agent 入口',C(12,5,2)+C(5,19,2)+C(19,19,2)+P('M12 7v5M5 17v-3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3'))
add('projects','Projects','项目总览入口',P('m12 3 9 5v9l-9 5-9-5V8l9-5Zm-9 5 9 5 9-5M12 13v9'))
add('branch','分支','工作区分支',C(6,5,2)+C(6,19,2)+C(18,8,2)+P('M6 7v10M6 15c0-5 12 0 12-5'))
add('chats','多 Agent 对话','多 Agent 对话分组',P('M13 4H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2v3l3-3M10 8h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2v3l-4-3h-5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2Z'))
add('participants','参与者','多人对话条目',C(8,8,3)+P('M3 21v-1a5 5 0 0 1 10 0v1M16 6a3 3 0 0 1 0 6M17 16a4 4 0 0 1 4 4v1'))
add('schedule','定时任务','定时任务入口；采用认可的日历循环方案',P('M11 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v5M3 8h18M14 14a4.5 4.5 0 0 1 7 2l1-3m-1 3-3-1M21 20a4.5 4.5 0 0 1-7-2l-1 3m1-3 3 1'))
# Six-tooth gear, same stroke as the rest of the family.
pts=[]
for i in range(48):
 a=2*math.pi*i/48; r=9 if i%8 in (1,2,3,4) else 7.3
 pts.append((12+math.sin(a)*r,12-math.cos(a)*r))
add('settings','设置','设置入口',P('M'+' L'.join(f'{x:.2f} {y:.2f}' for x,y in pts)+'Z')+C(12,12,3))
star='m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z'
add('star','收藏','收藏未选中 / 项目可选图形',P(star))
add('star-filled','已收藏','收藏选中',f'<path d="{star}" fill="currentColor"/>')
add('bell','通知','通知开启',P('M5 17c2-2 2-4 2-7a5 5 0 0 1 10 0c0 3 0 5 2 7H5ZM10 21h4'))
add('bell-muted','通知静音','通知关闭',P('M10 5.4A5 5 0 0 1 17 10v1M7 9v1c0 3 0 5-2 7h9M10 21h4M3 3l18 18'))
add('pin','置顶','置顶项目或对话',P('m14 3 7 7-3 1-4 4v3L6 10h3l4-4 1-3ZM10 14l-7 7'))
add('pin-off','取消置顶','取消置顶操作','<defs><mask id="cut"><rect width="24" height="24" fill="white" stroke="none"/><path d="M3 3 21 21" stroke="black" stroke-width="4"/></mask></defs><g mask="url(#cut)">'+icons['pin']['body']+'</g>'+P('M3 3l18 18'))
add('archive','归档','项目或对话归档',R(3,4,18,4,1)+P('M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8M9 12h6'))
add('trash','移除','移除项目入口',P('M4 6h16M9 6V3h6v3M6 9l1 12h10l1-12M12 10v7'))
add('palette','项目图标','设置图标与颜色 / 项目可选图形',P('M21 12c0-5-4-9-9-9a9 9 0 1 0 4 17c2-1 0-3-1-4-1-2 2-3 4-3 1 0 2 0 2-1Z')+C(8,9,.5)+C(12,7,.5)+C(6,13,.5))
add('plus','添加','添加项目或条目',P('M12 5v14M5 12h14'))
add('chevron-right','展开','折叠控制：向右',P('m9 6 6 6-6 6'))
add('chevron-down','收起','折叠控制：向下',P('m6 9 6 6 6-6'))
add('more','更多','条目菜单',C(5,12,.5)+C(12,12,.5)+C(19,12,.5))
add('check','选中','菜单选中状态',P('m5 12 4 4L19 6'))
add('terminal','终端','项目可选图形',R(3,4,18,16)+P('m7 9 3 3-3 3M13 16h4'))
add('database','数据库','项目可选图形','<ellipse cx="12" cy="6" rx="8" ry="3"/>'+P('M4 6v12c0 4 16 4 16 0V6M4 12c0 4 16 4 16 0'))
add('plugin','插件','项目可选图形',P('M9 6V5a3 3 0 0 1 6 0v1h5v5a3 3 0 1 0 0 6v4H4V6h5Z'))
add('cloud','云','项目可选图形',P('M7 19a4 4 0 0 1-1-8 6 6 0 0 1 12-1 4.5 4.5 0 0 1 0 9H7Z'))
add('book','书本','项目可选图形',P('M12 6C9 4 6 4 3 5v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v15'))
add('camera','相机','项目可选图形',P('M8 6l2-3h4l2 3h3a2 2 0 0 1 2 2v11H3V8a2 2 0 0 1 2-2h3Z')+C(12,12.5,3.5))

# Coordinates are centerlines. A 2-unit stroke extends one unit each side.
def replace(name, body): icons[name]['body'] = body
def point(cx, cy, r, degrees):
 a = math.radians(degrees)
 return (cx + r * math.cos(a), cy + r * math.sin(a))
def xy(p): return f'{p[0]:.4f} {p[1]:.4f}'
def rounded_polygon(points, trim=.45):
 corners=[]
 for i,b in enumerate(points):
  def near(q):
   length=math.dist(b,q); t=min(trim,length*.3)/length
   return (b[0]+(q[0]-b[0])*t,b[1]+(q[1]-b[1])*t)
  corners.append((near(points[i-1]),b,near(points[(i+1)%len(points)])))
 return 'M'+xy(corners[0][0])+''.join(
  (' L'+xy(a) if i else '')+' Q'+xy(b)+' '+xy(c)
  for i,(a,b,c) in enumerate(corners))+'Z'

replace('search',C(10.5,10.5,6.5)+P('M'+xy(point(10.5,10.5,6.5,45))+' L20 20'))
replace('folder-closed',P('M3 8V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm0 1h18'))
# Front flap is a sheared rounded rectangle: x' = x + .2*(20-y).
# Top and bottom straight edges are both 14 units; side edges are parallel.
# Keep baseline y20, x5..19. Allow the opened flap to extend to the right.
replace('folder-open',P('M5 20H19C20.10457 20 21.17909 19.10457 21.4 18L22.6 12C22.82091 10.89543 22.10457 10 21 10V8a2 2 0 0 0-2-2h-8L9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2Z')+P('M5 20C3.89543 20 3.17909 19.10457 3.4 18L4.6 12C4.82091 10.89543 5.89543 10 7 10H21'))
# Chat and folder share centerline bounds x=3..21, y=4..20.
replace('chat',P('M6 4h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-8l-4 2v-2a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Z'))
# Analytic isometric hexagon.
hexagon=[point(12,12,8.5,a) for a in [-90,-30,30,90,150,210]]
replace('projects',P('M'+' L'.join(map(xy,hexagon))+'Z')+P('M'+xy(hexagon[5])+' L12 12 L'+xy(hexagon[1])+' M12 12V20.5'))
replace('branch',C(6,5,2)+C(6,19,2)+C(18,7,2)+P('M6 7v10M6 15h6a6 6 0 0 0 6-6'))
# Six identical teeth, symmetric flanks, tangent-continuous trimmed corners.
gear=[]
for a in range(0,360,60):
 for offset,r in [(-30,7),(-19,7),(-12,9),(12,9),(19,7)]:
  gear.append(point(12,12,r,a+offset))
replace('settings',P(rounded_polygon(gear))+C(12,12,3))
# One open circular return arrow: fewer intersections at sidebar sizes.
# The 4-unit radius keeps a readable counter at 16px; a 3-unit head
# replaces the two short arrowheads that merged into blobs.
arrows=P('M19.3284 19.8284a4 4 0 1 1 0-5.6568L21 15.5M21 12.5v3h-3')
replace('schedule',P('M9 20H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v3M3 8h17')+arrows)
def dot(x,y,r=1.25): return f'<circle cx="{x}" cy="{y}" r="{r}" fill="currentColor" stroke="none"/>'
replace('more',''.join(dot(x,12) for x in [5,12,19]))
replace('palette',P('M21 12a9 9 0 1 0-9 9h1a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.2H18a3 3 0 0 0 3-2.5Z')+dot(8,8)+dot(13,6.5)+dot(6.5,13))
replace('database','<ellipse cx="12" cy="6" rx="8" ry="3"/>'+P('M4 6v12a8 3 0 0 0 16 0V6M4 12a8 3 0 0 0 16 0'))
# Concept-sheet additions; preserve the approved folder geometry above.
replace('settings',P('M3 7h4m4 0h10M3 17h10m4 0h4')+C(9,7,2)+C(15,17,2))
add('monitor','运行主机','运行位置',R(3,4,18,13)+P('M12 17v4M8 21h8'))
add('moon','深色主题','主题切换',P('M20.2 14.2A8.5 8.5 0 0 1 9.8 3.8a8.5 8.5 0 1 0 10.4 10.4Z'))
add('moon-star','切换主题','主题切换',P('M19.8 14.5A8 8 0 0 1 9.5 4.2a8 8 0 1 0 10.3 10.3Z')+P('M18 3v4M16 5h4'))
add('sun','浅色主题','主题切换',C(12,12,4)+P('M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5'))
# Second concept group: clean vector reconstruction, no traced raster contours.
add('server','服务器','远程运行位置',R(3,4,18,6)+R(3,14,18,6)+dot(17,7,.8)+dot(17,17,.8))
review_stem=C(6,5,2)+C(6,19,2)+P('M6 7v10')
add('review-open','待合并','PR / MR 开放',review_stem+C(18,19,2)+P('M18 17V9a4 4 0 0 0-4-4h-2m3-3-3 3 3 3'))
add('review-merged','已合并','PR / MR 已合并',review_stem+C(18,19,2)+P('M18 17v-2c0-5-12-3-12-8'))
add('review-closed','已关闭','PR / MR 已关闭',review_stem+C(18,19,2)+P('M18 17v-5M15 3l6 6M21 3l-6 6'))
shield=P('M12 3C9.5 5 7 5.7 4 6v5c0 4.8 3.1 7.7 8 10 4.9-2.3 8-5.2 8-10V6c-3-.3-5.5-1-8-3Z')
add('shield','权限','权限通用',shield)
add('shield-ask','询问权限','每次询问',shield+P('M12 8v4')+dot(12,15,.8))
add('shield-check','允许执行','自动批准',shield+P('m8.5 11.5 2.5 2.5 4.5-5'))
add('shield-restricted','受限权限','只读',shield+P('M9 11.5h6'))
file=P('M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-.586-1.414l-5-5A2 2 0 0 0 13 3Z')+P('M13 3v5a2 2 0 0 0 2 2h5')
add('file','文件','文件资源',file)
add('file-text','文本文件','文本资源',file+P('M8 14h8M8 17h5'))
add('browser','浏览器','浏览器工具面板',R(3,4,18,16)+P('M3 9h18')+dot(6,6.5,.6)+dot(9,6.5,.6))
add('panel-left','左侧栏','展开或收起左侧栏',R(3,4,18,16)+P('M9 4v16'))
add('panel-right','右侧栏','展开或收起右侧栏',R(3,4,18,16)+P('M15 4v16'))
add('panel-top','顶部面板','顶部布局',R(3,4,18,16)+P('M3 10h18'))
add('globe','网页','网址及网站资源',C(12,12,9)+P('M3 12h18M12 3c-5 4.5-5 13.5 0 18M12 3c5 4.5 5 13.5 0 18'))
# All interface glyphs share the same true centerline stroke.
rebuilt=('compose','search','coordination','projects','schedule')
def stroke(name): return 1.75
for name,item in icons.items():
 svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="{stroke(name)}" stroke-linecap="round" stroke-linejoin="round">{item["body"]}</svg>'
 (root/f'{name}.svg').write_text(svg)
 ET.fromstring(svg)
manifest=[dict(id=k, label=v['label'],use=v['use'],file=k+'.svg') for k,v in icons.items()]
(root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
cards=[]
for name,item in icons.items():
 svg=(root/f'{name}.svg').read_text()
 samples=''.join(f'<span style="width:{size}px;height:{size}px">{svg.replace(chr(34)+"cut"+chr(34),chr(34)+name+str(size)+chr(34)).replace("#cut","#"+name+str(size))}</span>' for size in [40,24,20,16])
 cards.append(f'<article><div class="samples">{samples}</div><b>{item["label"]}</b><p>{item["use"]}</p><a href="{name}.svg">{name}.svg</a></article>')
html='''<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Backchat 图标规范稿</title><style>*{box-sizing:border-box}body{margin:32px;background:#f6f6f8;color:#464649;font:14px system-ui}h1{font-size:24px}header p{color:#747478}button{padding:8px 16px;border:1px solid #ccc;border-radius:8px;background:transparent;color:inherit;cursor:pointer}main{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:24px}article{padding:22px;background:#fff;border-radius:12px;min-width:0}.samples{display:flex;align-items:center;gap:20px;height:70px;margin-bottom:10px}.samples span{display:inline-flex;flex:none}svg{width:100%;height:100%}article p{font-size:12px;color:#777;min-height:32px}a{font-size:12px;color:inherit}body.dark{background:#18181b;color:#dedee4}.dark article{background:#252529}.dark p{color:#aaa}@media(max-width:900px){main{grid-template-columns:repeat(2,1fr)}}</style><header><h1>Backchat · 图标规范稿</h1><p>'''+str(len(icons))+''' 个 SVG · 24 × 24 画布 · 统一 1.75 描边 · 展示尺寸 40 / 24 / 20 / 16 px</p><button onclick="document.body.classList.toggle('dark')">切换深浅背景</button><p>已认可方向：文件夹、圆形搜索、日历循环定时任务。其余为按规范整理的候选；项目图形仅供自选，不代表项目类型。</p></header><main>'''+''.join(cards)+'</main></html>'
(root/'preview.html').write_text(html)
print('Created',len(icons),'SVGs')

# React and standalone SVG share the same geometry source.
components=['import { forwardRef, useId, type SVGProps } from "react";',
 '// Generated by scripts/icons/build.py. Edit the geometry source.',
 'type IconProps = SVGProps<SVGSVGElement> & { weight?: string; size?: number | string };']
for name,item in icons.items():
 component=''.join(part.title() for part in name.split('-'))+'Icon'
 body=item['body'].replace('stroke-width=', 'strokeWidth=')
 setup=''
 if name=='pin-off':
  setup='const cut = useId();'
  body=body.replace('id="cut"', 'id={cut}').replace('mask="url(#cut)"', 'mask={"url(#" + cut + ")"}')
 components.append(f"""export const {component} = forwardRef<SVGSVGElement, IconProps>(function {component}(props, ref) {{
  const {{ weight: _weight, size = 24, ...rest }} = props;
  {setup}
  return <svg ref={{ref}} width={{size}} height={{size}} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" {{...rest}} strokeWidth={{{stroke(name)}}} strokeLinecap="round" strokeLinejoin="round" data-backchat-icon="{name}">{body}</svg>;
}});""")
(repo/'src/renderer/src/components/BackchatIcons.tsx').write_text('\n'.join(components)+'\n')

# Focused review sheet: large construction plus actual sidebar sizes.
rows=[]
for name in (*rebuilt, 'chats', 'folder-closed', 'folder-open', 'branch'):
 svg=(root/f'{name}.svg').read_text()
 samples=''.join(f'<span class="sample"><span style="width:{size}px;height:{size}px">{svg}</span><small>{size}px</small></span>' for size in [64,24,20,16])
 rows.append(f'<div class="row"><label>{icons[name]["label"]}</label>{samples}</div>')
review='<!doctype html><html lang="zh"><meta charset="utf-8"><title>主导航图标 · 几何重建</title><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#fafafa;color:#292929;font:14px system-ui}h1{font-size:20px;margin:0 0 8px}p{color:#707070;margin:0 0 24px}.columns{display:flex;gap:24px}.sheet{flex:1;min-width:0;padding:20px}.dark{background:#202124;color:#eee;border-radius:12px}.row{height:110px;display:flex;align-items:center;gap:28px;border-bottom:1px solid #8883}label{width:76px;flex:none;font-size:13px}.sample{display:flex;align-items:center;flex-direction:column;gap:12px;min-width:30px}.sample>span{display:block}svg{display:block;width:100%;height:100%}small{font-size:10px;color:#888}</style><h1>主导航图标 · 几何重建</h1><p>24 × 24 · 1.75 描边 · 圆端点 · 透明 SVG · 64 / 24 / 20 / 16 px</p><div class="columns">' + ''.join('<section class="sheet '+theme+'">'+''.join(rows)+'</section>' for theme in ['', 'dark'])+'</div></html>'
(root/'rebuilt.html').write_text(review)

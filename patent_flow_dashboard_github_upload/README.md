# 全球专利交易流向交互地图

本项目基于已经生成的四类专利交易流向统计 Excel，生成本地可运行的交互式网页。

## 文件结构

- `index.html`：网页入口。
- `style.css`：页面样式。
- `app.js`：地图、筛选器、详情面板和排名表交互逻辑。
- `preprocess_patent_flow_dashboard.py`：将 Excel 转换为网页使用的 JSON 数据。
- `data/`：预处理后生成的数据文件。
- `data/world_countries.geojson`：本地世界国家边界底图。

## 数据来源

预处理脚本默认读取上一级目录中的文件：

- `买方卖方流向_技术类型统计4_基本.xlsx`
- `买方卖方流向_技术类型统计4_交易类型.xlsx`
- `买方卖方流向_技术类型统计4_技术领域.xlsx`
- `买方卖方流向_技术类型统计4_全.xlsx`
- `country对应_首都经纬度和标签.xlsx`

国家表字段名可以与提示词不完全一致。脚本会自动识别：

- `Raw code`
- `Adjusted country ISO code`
- `Adjusted country/region`
- `经度`
- `纬度`
- `实体国家`
- `国际避税地`

网页展示前，脚本会把原始国家代码按 `Adjusted country ISO code` 归并到国家层面，避免同一国家的 BvD/注册机构后缀码形成大量重叠节点。

## 生成数据

在本目录运行：

```bash
python preprocess_patent_flow_dashboard.py
```

生成的数据包括：

- `data/base_flow.json`
- `data/type_flow.json`
- `data/tech_flow.json`
- `data/full_flow.json`
- `data/country_mapping.json`
- `data/tech_field_reference.json`
- `data/metadata.json`
- `data/diagnostics.json`

## 打开网页

建议启动本地服务后打开网页：

```bash
python -m http.server 8765
```

然后访问：

```text
http://127.0.0.1:8765/
```

不要直接双击 `index.html` 用 `file://` 打开；浏览器会限制读取本地 JSON 数据文件。

## 地图底图

当前版本使用本地 `data/world_countries.geojson` 作为世界国家边界底图。该文件下载自：

```text
https://github.com/johan/world.geo.json
```

网页加载后会优先使用该 GeoJSON 绘制真实世界地图。如果该文件缺失，会回退到简化轮廓底图。

## 布局调整

页面支持两个动态拖拽边界：

- 左侧筛选栏右边界：左右拖动可调整筛选栏宽度，为地图区域释放或收回空间。
- 地图下边界：上下拖动可调整地图高度，下方排名表和详情区会自动重新分配位置。

调整结果会保存在浏览器本地，下次打开时自动沿用。

## 默认展示

- 年份范围：全部年份
- 质量指标：`hq_adj1_top10`
- 统计指标：专利数量 `trans_patent`
- 时间汇总：不汇总
- 交易类型：全部
- 技术领域：全部
- 流向类型：全部
- 地图显示：Top 100

## 时间汇总

网页提供“时间汇总”选项：

- `不汇总`：每条线对应一个“卖方国家-买方国家-交易年份”的统计结果，也就是原始统计 Excel 中的一行。
- `汇总`：在当前选定年份范围、阶段、质量口径、交易类型、技术领域等筛选条件下，按“卖方国家-买方国家”加总后绘图。若当前选择了具体交易类型或技术领域，则在该交易类型或技术领域内加总。

汇总模式使用的是已生成统计结果的跨年份加总。交易次数可以直接相加；专利数量是各年份统计值之和，不重新回到原始专利明细层面做跨年份去重。

## 口径说明

基础流向表是整体流向的唯一来源。

交易类型和技术领域是多标签统计口径，因此不同交易类型、不同技术领域不能简单加总还原整体流向。

质量指标基于“被其他专利引用数量_adj1”在唯一申请编号层面的分布生成。`top1`、`top5`、`top10`、`top25` 是嵌套口径，不能相加。

如果地图为空，可以尝试：

- 放宽年份范围；
- 将交易类型或技术领域切回“全部”；
- 降低最小值；
- 切换为 `all` 或 `hq_adj1_ge1`；
- 增大 Top N。

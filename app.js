"use strict";

const DATA_DIR = "./data/";
const SVG_NS = "http://www.w3.org/2000/svg";

const state = {
  yearFrom: null,
  yearTo: null,
  period: "全部",
  quality: "hq_adj1_top10",
  measure: "trans_patent",
  timeAgg: "none",
  transactionType: "all",
  techId: "all",
  flowType: "all",
  country: "",
  countryRole: "any",
  minValue: null,
  maxValue: null,
  topN: 100,
  selected: null,
};

const cache = {
  countries: null,
  metadata: null,
  techFields: null,
  worldGeoJSON: null,
  tables: {},
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  collectElements();
  if (window.location.protocol === "file:") {
    showFileProtocolNotice();
    return;
  }
  showLoading("加载国家映射、指标元数据和基础流向...");
  applyStoredLayout();
  const [countryPayload, metadata, techPayload, worldGeoJSON] = await Promise.all([
    fetchJSON("country_mapping.json"),
    fetchJSON("metadata.json"),
    fetchJSON("tech_field_reference.json"),
    fetchJSON("world_countries.geojson").catch(() => null),
  ]);
  cache.countries = countryPayload.countries;
  cache.metadata = metadata;
  cache.techFields = techPayload.tech_fields;
  cache.worldGeoJSON = worldGeoJSON;

  populateControls();
  bindEvents();
  initResizers();

  await ensureTable("base");
  const baseRows = getTableRows("base");
  const years = baseRows.map((d) => d.year).filter(Boolean);
  state.yearFrom = Math.min(...years);
  state.yearTo = Math.max(...years);
  els.yearFrom.value = state.yearFrom;
  els.yearTo.value = state.yearTo;

  await render();
}

function showFileProtocolNotice() {
  const msg = `
    当前页面是用 <strong>file://</strong> 方式直接打开的。浏览器会限制网页读取
    <code>data/*.json</code> 数据文件，因此地图、排名表和筛选联动可能无法正常显示。
    <br><br>
    请在 <code>patent_flow_dashboard</code> 目录下运行：
    <br>
    <code>python -m http.server 8765</code>
    <br><br>
    然后访问：
    <br>
    <code>http://127.0.0.1:8765/</code>
  `;
  if (els.viewSubtitle) {
    els.viewSubtitle.innerHTML = `<span class="status-warning">需要通过本地服务打开页面。</span>`;
  }
  if (els.detailContent) {
    els.detailContent.innerHTML = msg;
  }
}

function collectElements() {
  [
    "periodSelect", "yearFrom", "yearTo", "qualitySelect", "measureSelect", "timeAggSelect",
    "typeSelect", "techSelect", "flowTypeSelect", "countrySelect",
    "countryRoleSelect", "minValue", "maxValue", "topNSelect", "resetBtn",
    "flowMap", "tooltip", "viewTitle", "viewSubtitle", "rankingTable",
    "rowCountLabel", "detailContent", "trendChart", "sidebarResizer", "mapResizer",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

async function fetchJSON(name) {
  const response = await fetch(`${DATA_DIR}${name}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`无法加载 ${name}: ${response.status}`);
  }
  return response.json();
}

async function ensureTable(kind) {
  if (cache.tables[kind]) return;
  const file = {
    base: "base_flow.json",
    type: "type_flow.json",
    tech: "tech_flow.json",
    full: "full_flow.json",
  }[kind];
  showLoading(`加载 ${file}...`);
  cache.tables[kind] = await fetchJSON(file);
}

function getTableRows(kind) {
  const table = cache.tables[kind];
  if (!table.objects) {
    table.objects = table.rows.map((row) => {
      const obj = {};
      table.columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }
  return table.objects;
}

function populateControls() {
  fillSelect(
    els.periodSelect,
    cache.metadata.periods.map((p) => [p, p]),
    state.period,
  );
  fillSelect(
    els.qualitySelect,
    cache.metadata.quality_metrics.map((q) => [q, cache.metadata.quality_labels[q] || q]),
    state.quality,
  );
  fillSelect(
    els.typeSelect,
    [["all", "全部交易类型"]].concat(cache.metadata.transaction_types.map((t) => [t, t])),
    state.transactionType,
  );
  fillSelect(
    els.techSelect,
    [["all", "全部技术领域"]].concat(
      cache.techFields.map((t) => [String(t.tech_id), `${t.tech_id}. ${t.name}`]),
    ),
    state.techId,
  );

  const countryOptions = [["", "全部国家/地区"]];
  Object.values(cache.countries)
    .sort((a, b) => (a.name_en || a.code).localeCompare(b.name_en || b.code))
    .forEach((c) => {
      countryOptions.push([c.code, `${c.name_en || c.code} (${c.code})`]);
    });
  fillSelect(els.countrySelect, countryOptions, state.country);
}

function fillSelect(select, options, selected) {
  select.innerHTML = "";
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (value === selected) option.selected = true;
    select.appendChild(option);
  }
}

function bindEvents() {
  [
    els.periodSelect, els.yearFrom, els.yearTo, els.qualitySelect, els.measureSelect, els.timeAggSelect,
    els.typeSelect, els.techSelect, els.flowTypeSelect, els.countrySelect,
    els.countryRoleSelect, els.minValue, els.maxValue, els.topNSelect,
  ].forEach((el) => {
    el.addEventListener("change", () => {
      updateStateFromControls();
      state.selected = null;
      render();
    });
  });

  els.resetBtn.addEventListener("click", () => {
    state.period = "全部";
    state.quality = "hq_adj1_top10";
    state.measure = "trans_patent";
    state.timeAgg = "none";
    state.transactionType = "all";
    state.techId = "all";
    state.flowType = "all";
    state.country = "";
    state.countryRole = "any";
    state.minValue = null;
    state.maxValue = null;
    state.topN = 100;
    const baseRows = getTableRows("base");
    const years = baseRows.map((d) => d.year).filter(Boolean);
    state.yearFrom = Math.min(...years);
    state.yearTo = Math.max(...years);
    syncControls();
    render();
  });

  document.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => applyQuickAction(btn.dataset.action));
  });

  window.addEventListener("resize", debounce(render, 180));
}

function updateStateFromControls() {
  state.period = els.periodSelect.value;
  state.yearFrom = parseInt(els.yearFrom.value, 10);
  state.yearTo = parseInt(els.yearTo.value, 10);
  state.quality = els.qualitySelect.value;
  state.measure = els.measureSelect.value;
  state.timeAgg = els.timeAggSelect.value;
  state.transactionType = els.typeSelect.value;
  state.techId = els.techSelect.value;
  state.flowType = els.flowTypeSelect.value;
  state.country = els.countrySelect.value;
  state.countryRole = els.countryRoleSelect.value;
  state.minValue = els.minValue.value === "" ? null : Number(els.minValue.value);
  state.maxValue = els.maxValue.value === "" ? null : Number(els.maxValue.value);
  state.topN = els.topNSelect.value === "all" ? "all" : Number(els.topNSelect.value);
}

function syncControls() {
  els.periodSelect.value = state.period;
  els.yearFrom.value = state.yearFrom;
  els.yearTo.value = state.yearTo;
  els.qualitySelect.value = state.quality;
  els.measureSelect.value = state.measure;
  els.timeAggSelect.value = state.timeAgg;
  els.typeSelect.value = state.transactionType;
  els.techSelect.value = state.techId;
  els.flowTypeSelect.value = state.flowType;
  els.countrySelect.value = state.country;
  els.countryRoleSelect.value = state.countryRole;
  els.minValue.value = state.minValue ?? "";
  els.maxValue.value = state.maxValue ?? "";
  els.topNSelect.value = String(state.topN);
}

function applyQuickAction(action) {
  if (action === "chinaBuyer") {
    state.country = "CN";
    state.countryRole = "buyer";
  } else if (action === "chinaSeller") {
    state.country = "CN";
    state.countryRole = "seller";
  } else if (action === "usRelated") {
    state.country = "US";
    state.countryRole = "any";
  } else if (action === "entityToHaven") {
    state.flowType = "entity_haven";
  } else if (action === "havenToEntity") {
    state.flowType = "haven_entity";
  } else if (action === "semiconductors") {
    setTechByName("Semiconductors");
  } else if (action === "computer") {
    setTechByName("Computer technology");
  } else if (action === "biomed") {
    setTechByName("Biotechnology");
  } else if (action === "after2018") {
    state.period = "全部";
    state.yearFrom = 2018;
  } else if (action === "after2020") {
    state.period = "全部";
    state.yearFrom = 2020;
  }
  state.selected = null;
  syncControls();
  render();
}

function setTechByName(name) {
  const tech = cache.techFields.find((t) => t.name.toLowerCase() === name.toLowerCase());
  if (tech) state.techId = String(tech.tech_id);
}

function datasetKind() {
  const hasType = state.transactionType !== "all";
  const hasTech = state.techId !== "all";
  if (hasType && hasTech) return "full";
  if (hasType) return "type";
  if (hasTech) return "tech";
  return "base";
}

function metricKey(quality = state.quality, measure = state.measure) {
  return cache.metadata.metric_columns[quality][measure];
}

async function render() {
  try {
    updateStateFromControls();
    const kind = datasetKind();
    await ensureTable(kind);
    const rows = getTableRows(kind);
    const prefiltered = filterRows(rows, kind, { applyValueRange: state.timeAgg !== "sum" });
    const filtered = state.timeAgg === "sum"
      ? applyValueRange(aggregateRows(prefiltered, kind))
      : prefiltered;
    const key = metricKey();
    filtered.sort((a, b) => (b[key] || 0) - (a[key] || 0));
    const displayed = state.topN === "all" ? filtered : filtered.slice(0, state.topN);

    drawMap(displayed, filtered);
    drawTable(displayed, filtered.length);
    updateTitle(kind, displayed, filtered);
    if (!state.selected && displayed.length) {
      updateDetail(displayed[0], kind);
    } else if (state.selected) {
      updateDetail(state.selected, kind);
    } else {
      els.detailContent.textContent = "当前筛选条件下没有可展示的流向。";
      clearSvg(els.trendChart);
    }
  } catch (err) {
    console.error(err);
    els.viewSubtitle.innerHTML = `<span class="status-warning">${err.message}</span>`;
  }
}

function filterRows(rows, kind, options = {}) {
  const applyRange = options.applyValueRange !== false;
  const key = metricKey();
  return rows.filter((row) => {
    if (!row.year || row.year < state.yearFrom || row.year > state.yearTo) return false;
    if (state.period !== "全部" && row.period !== state.period) return false;
    if (state.transactionType !== "all" && row.transaction_type !== state.transactionType) return false;
    if (state.techId !== "all" && String(row.tech_id) !== String(state.techId)) return false;
    const value = Number(row[key] || 0);
    if (applyRange) {
      if (value <= 0) return false;
      if (state.minValue !== null && value < state.minValue) return false;
      if (state.maxValue !== null && value > state.maxValue) return false;
    }
    if (!countryRoleMatch(row)) return false;
    if (!flowTypeMatch(row)) return false;
    return true;
  });
}

function applyValueRange(rows) {
  const key = metricKey();
  return rows.filter((row) => {
    const value = Number(row[key] || 0);
    if (value <= 0) return false;
    if (state.minValue !== null && value < state.minValue) return false;
    if (state.maxValue !== null && value > state.maxValue) return false;
    return true;
  });
}

function aggregateRows(rows, kind) {
  const metricCols = Object.values(cache.metadata.metric_columns)
    .flatMap((pair) => [pair.trans_times, pair.trans_patent]);
  const groupKeys = ["seller", "buyer"];
  if (kind === "type" || kind === "full") groupKeys.push("transaction_type");
  if (kind === "tech" || kind === "full") groupKeys.push("tech_id");

  const groups = new Map();
  for (const row of rows) {
    const id = groupKeys.map((k) => row[k] ?? "").join("||");
    if (!groups.has(id)) {
      const out = {
        year: "汇总",
        period: `${state.yearFrom}-${state.yearTo}`,
        seller: row.seller,
        buyer: row.buyer,
        is_aggregated: true,
      };
      if (row.transaction_type) out.transaction_type = row.transaction_type;
      if (row.tech_id) out.tech_id = row.tech_id;
      for (const col of metricCols) out[col] = 0;
      groups.set(id, out);
    }
    const out = groups.get(id);
    for (const col of metricCols) {
      out[col] += Number(row[col] || 0);
    }
  }
  return Array.from(groups.values());
}

function countryRoleMatch(row) {
  if (!state.country) return true;
  if (state.countryRole === "seller") return row.seller === state.country;
  if (state.countryRole === "buyer") return row.buyer === state.country;
  return row.seller === state.country || row.buyer === state.country;
}

function flowTypeMatch(row) {
  if (state.flowType === "all") return true;
  const type = classifyFlow(row.seller, row.buyer);
  if (state.flowType === "china") return isChina(row.seller) || isChina(row.buyer);
  return type.id === state.flowType;
}

function classifyFlow(seller, buyer) {
  const s = cache.countries[seller];
  const b = cache.countries[buyer];
  const sg = s?.group || "其他国家/地区";
  const bg = b?.group || "其他国家/地区";
  if (sg === "实体产业国家" && bg === "实体产业国家") {
    return { id: "entity_entity", label: "实体→实体", color: "#2563eb" };
  }
  if (sg === "实体产业国家" && bg === "避税地/控股节点") {
    return { id: "entity_haven", label: "实体→避税地", color: "#dc2626" };
  }
  if (sg === "避税地/控股节点" && bg === "实体产业国家") {
    return { id: "haven_entity", label: "避税地→实体", color: "#16a34a" };
  }
  if (sg === "避税地/控股节点" && bg === "避税地/控股节点") {
    return { id: "haven_haven", label: "避税地→避税地", color: "#0d9488" };
  }
  return { id: "other", label: "其他流向", color: "#6b7280" };
}

function isChina(code) {
  return code === "CN";
}

function countryName(code) {
  const c = cache.countries[code];
  return c ? `${c.name_en || code} (${code})` : code;
}

function techName(id = state.techId) {
  if (!id || id === "all") return "全部技术领域";
  const tech = cache.techFields.find((t) => String(t.tech_id) === String(id));
  return tech ? tech.name : `tech${id}`;
}

function drawMap(rows, allFiltered) {
  const svg = els.flowMap;
  clearSvg(svg);
  const rect = svg.getBoundingClientRect();
  const width = Math.max(640, rect.width || 900);
  const height = Math.max(360, rect.height || 520);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const defs = makeEl("defs");
  defs.innerHTML = `
    <marker id="arrow-blue" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4.2" markerHeight="4.2" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,1.7 L7,4 L0,6.3 z" fill="#2563eb" opacity="0.82"></path></marker>
    <marker id="arrow-red" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4.2" markerHeight="4.2" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,1.7 L7,4 L0,6.3 z" fill="#dc2626" opacity="0.82"></path></marker>
    <marker id="arrow-green" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4.2" markerHeight="4.2" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,1.7 L7,4 L0,6.3 z" fill="#16a34a" opacity="0.82"></path></marker>
    <marker id="arrow-purple" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4.2" markerHeight="4.2" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,1.7 L7,4 L0,6.3 z" fill="#8b1a8b" opacity="0.82"></path></marker>
    <marker id="arrow-gray" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="4.2" markerHeight="4.2" markerUnits="userSpaceOnUse" orient="auto"><path d="M0,1.7 L7,4 L0,6.3 z" fill="#6b7280" opacity="0.76"></path></marker>
  `;
  svg.appendChild(defs);

  drawGraticule(svg, width, height);
  drawWorldMap(svg, width, height);

  const key = metricKey();
  const maxValue = Math.max(...rows.map((r) => Number(r[key] || 0)), 1);
  const densityScale = rows.length > 1500 ? 0.48 : rows.length > 800 ? 0.58 : rows.length > 400 ? 0.72 : rows.length > 180 ? 0.86 : 1;
  const nodeStats = aggregateNodes(rows);

  rows.forEach((row) => {
    const seller = cache.countries[row.seller];
    const buyer = cache.countries[row.buyer];
    if (!hasCoords(seller) || !hasCoords(buyer)) return;
    const [x1, y1] = project(seller.lon, seller.lat, width, height);
    const [x2, y2] = project(buyer.lon, buyer.lat, width, height);
    const value = Number(row[key] || 0);
    const flowType = classifyFlow(row.seller, row.buyer);
    const china = isChina(row.seller) || isChina(row.buyer);
    const color = china ? "#8b1a8b" : flowType.color;
    const curve = curveParams(x1, y1, x2, y2);
    const path = makeEl("path", {
      d: curve.path,
      class: "flow-line",
      stroke: color,
      "stroke-width": String((0.55 + 4.4 * Math.sqrt(value / maxValue)) * densityScale),
      "stroke-opacity": String(0.16 + 0.5 * Math.sqrt(value / maxValue)),
    });
    path.addEventListener("mousemove", (event) => showFlowTooltip(event, row));
    path.addEventListener("mouseleave", hideTooltip);
    path.addEventListener("click", () => {
      state.selected = row;
      updateDetail(row, datasetKind());
    });
    svg.appendChild(path);
    const arrow = makeCurveArrow(curve, color, value, maxValue, densityScale);
    if (arrow) {
      arrow.addEventListener("mousemove", (event) => showFlowTooltip(event, row));
      arrow.addEventListener("mouseleave", hideTooltip);
      arrow.addEventListener("click", () => {
        state.selected = row;
        updateDetail(row, datasetKind());
      });
      svg.appendChild(arrow);
    }
  });

  Object.entries(nodeStats).forEach(([code, stats]) => {
    const c = cache.countries[code];
    if (!hasCoords(c)) return;
    const [x, y] = project(c.lon, c.lat, width, height);
    const radius = Math.max(3.4, Math.min(14, 3 + Math.sqrt(stats.total) / 12));
    const node = makeEl("circle", {
      cx: x,
      cy: y,
      r: radius,
      class: `country-node ${isChina(code) ? "china" : ""}`,
      fill: isChina(code) ? "#8b1a8b" : "#334155",
      "fill-opacity": isChina(code) ? "0.92" : "0.76",
    });
    node.addEventListener("mousemove", (event) => showNodeTooltip(event, code, stats));
    node.addEventListener("mouseleave", hideTooltip);
    svg.appendChild(node);
  });

  drawMapLabels(svg, width, height);
}

function hasCoords(country) {
  return country && Number.isFinite(country.lon) && Number.isFinite(country.lat);
}

function project(lon, lat, width, height) {
  const x = ((Number(lon) + 180) / 360) * width;
  const y = ((90 - Number(lat)) / 180) * height;
  return [x, y];
}

function curveParams(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 2) {
    const r = 24;
    const cx = x1 + r;
    const cy = y1 - r;
    return {
      x1,
      y1,
      x2,
      y2,
      cx,
      cy,
      dist,
      path: `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${(x1 + r * 1.4).toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${(cy + r).toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`,
      selfLoop: true,
    };
  }
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const bend = Math.min(90, Math.max(18, Math.sqrt(dx * dx + dy * dy) * 0.18));
  const cx = mx - dy * 0.12;
  const cy = my + dx * 0.12 - bend;
  return {
    x1,
    y1,
    x2,
    y2,
    cx,
    cy,
    dist,
    path: `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`,
    selfLoop: false,
  };
}

function makeCurveArrow(curve, color, value, maxValue, densityScale) {
  if (!curve || curve.dist < 8 || curve.selfLoop) return null;
  const t = Math.max(0.72, Math.min(0.9, 1 - 24 / Math.max(60, curve.dist)));
  const p = quadPoint(curve, t);
  const d = quadDerivative(curve, t);
  const len = Math.sqrt(d.x * d.x + d.y * d.y);
  if (!len) return null;
  const ux = d.x / len;
  const uy = d.y / len;
  const nx = -uy;
  const ny = ux;
  const valueScale = Math.sqrt(Number(value || 0) / Math.max(1, maxValue));
  const size = (4.8 + 2.2 * valueScale) * Math.max(0.75, Math.min(1, densityScale + 0.18));
  const half = size * 0.42;
  const tip = { x: p.x + ux * size * 0.55, y: p.y + uy * size * 0.55 };
  const base = { x: p.x - ux * size * 0.55, y: p.y - uy * size * 0.55 };
  const dAttr = [
    `M ${tip.x.toFixed(1)} ${tip.y.toFixed(1)}`,
    `L ${(base.x + nx * half).toFixed(1)} ${(base.y + ny * half).toFixed(1)}`,
    `L ${(base.x - nx * half).toFixed(1)} ${(base.y - ny * half).toFixed(1)}`,
    "Z",
  ].join(" ");
  return makeEl("path", {
    d: dAttr,
    class: "flow-arrow",
    fill: color,
    "fill-opacity": "0.78",
  });
}

function quadPoint(curve, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * curve.x1 + 2 * mt * t * curve.cx + t * t * curve.x2,
    y: mt * mt * curve.y1 + 2 * mt * t * curve.cy + t * t * curve.y2,
  };
}

function quadDerivative(curve, t) {
  return {
    x: 2 * (1 - t) * (curve.cx - curve.x1) + 2 * t * (curve.x2 - curve.cx),
    y: 2 * (1 - t) * (curve.cy - curve.y1) + 2 * t * (curve.y2 - curve.cy),
  };
}

function markerId(color) {
  if (color === "#2563eb") return "arrow-blue";
  if (color === "#dc2626") return "arrow-red";
  if (color === "#16a34a") return "arrow-green";
  if (color === "#8b1a8b") return "arrow-purple";
  return "arrow-gray";
}

function drawGraticule(svg, width, height) {
  for (let lon = -120; lon <= 120; lon += 60) {
    const [x] = project(lon, 0, width, height);
    svg.appendChild(makeEl("line", { x1: x, y1: 0, x2: x, y2: height, class: "graticule" }));
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const [, y] = project(0, lat, width, height);
    svg.appendChild(makeEl("line", { x1: 0, y1: y, x2: width, y2: y, class: "graticule" }));
  }
  svg.appendChild(makeEl("rect", {
    x: 1,
    y: 1,
    width: width - 2,
    height: height - 2,
    fill: "none",
    stroke: "rgba(15,23,42,0.18)",
    "stroke-width": 1,
  }));
}

function drawWorldMap(svg, width, height) {
  if (cache.worldGeoJSON?.features?.length) {
    const group = makeEl("g", { "aria-label": "world map background" });
    for (const feature of cache.worldGeoJSON.features) {
      const d = geoFeaturePath(feature, width, height);
      if (!d) continue;
      group.appendChild(makeEl("path", {
        d,
        class: "land-shape",
      }));
    }
    svg.appendChild(group);
    return;
  }

  const landShapes = [
    {
      name: "North America",
      points: [
        [-168, 72], [-148, 70], [-138, 62], [-130, 58], [-124, 49],
        [-126, 40], [-117, 32], [-106, 25], [-96, 17], [-88, 18],
        [-82, 25], [-73, 40], [-58, 48], [-54, 58], [-72, 66],
        [-100, 72], [-132, 73], [-168, 72],
      ],
    },
    {
      name: "Greenland",
      points: [
        [-73, 60], [-55, 59], [-34, 64], [-22, 74], [-40, 82],
        [-58, 82], [-72, 75], [-73, 60],
      ],
    },
    {
      name: "South America",
      points: [
        [-81, 12], [-70, 10], [-58, 2], [-48, -9], [-43, -23],
        [-53, -36], [-61, -53], [-72, -54], [-76, -36], [-81, -16],
        [-81, 12],
      ],
    },
    {
      name: "Europe",
      points: [
        [-11, 72], [4, 70], [18, 63], [30, 58], [40, 48], [34, 40],
        [20, 36], [5, 38], [-7, 44], [-21, 56], [-11, 72],
      ],
    },
    {
      name: "Africa",
      points: [
        [-18, 36], [4, 37], [24, 33], [35, 23], [48, 10], [44, -15],
        [31, -33], [18, -35], [5, -30], [-8, -15], [-15, 6],
        [-18, 36],
      ],
    },
    {
      name: "Asia",
      points: [
        [32, 72], [58, 73], [92, 67], [125, 61], [155, 53], [169, 44],
        [150, 28], [136, 18], [126, 8], [116, -6], [102, 2],
        [95, 18], [80, 8], [68, 20], [55, 25], [46, 34], [34, 41],
        [40, 50], [32, 72],
      ],
    },
    {
      name: "Southeast Asia",
      points: [
        [94, 22], [108, 20], [121, 16], [126, 8], [121, 0],
        [108, -7], [99, 0], [96, 10], [94, 22],
      ],
    },
    {
      name: "Japan Korea",
      points: [
        [126, 42], [137, 44], [145, 38], [142, 30], [131, 32],
        [126, 42],
      ],
    },
    {
      name: "Australia",
      points: [
        [112, -11], [130, -10], [153, -20], [154, -34], [138, -43],
        [117, -35], [112, -22], [112, -11],
      ],
    },
    {
      name: "New Zealand",
      points: [
        [166, -34], [178, -38], [174, -46], [164, -43], [166, -34],
      ],
    },
    {
      name: "Antarctica",
      points: [
        [-180, -68], [-120, -72], [-60, -69], [0, -73], [60, -69],
        [120, -72], [180, -68], [180, -90], [-180, -90], [-180, -68],
      ],
      soft: true,
    },
  ];

  const group = makeEl("g", { "aria-label": "world map background" });
  for (const shape of landShapes) {
    group.appendChild(makeEl("path", {
      d: polygonPath(shape.points, width, height),
      class: `land-shape${shape.soft ? " coast-soft" : ""}`,
    }));
  }
  svg.appendChild(group);
}

function geoFeaturePath(feature, width, height) {
  const geom = feature?.geometry;
  if (!geom || !geom.coordinates) return "";
  if (geom.type === "Polygon") {
    return geom.coordinates.map((ring) => ringPath(ring, width, height)).join(" ");
  }
  if (geom.type === "MultiPolygon") {
    return geom.coordinates
      .flatMap((polygon) => polygon.map((ring) => ringPath(ring, width, height)))
      .join(" ");
  }
  return "";
}

function ringPath(ring, width, height) {
  if (!Array.isArray(ring) || ring.length < 2) return "";
  return ring
    .map(([lon, lat], i) => {
      const [x, y] = project(lon, lat, width, height);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ") + " Z";
}

function polygonPath(points, width, height) {
  return points
    .map(([lon, lat], i) => {
      const [x, y] = project(lon, lat, width, height);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ") + " Z";
}

function drawMapLabels(svg, width, height) {
  const labels = [
    ["North America", -105, 48],
    ["Europe", 15, 54],
    ["East Asia", 115, 35],
    ["Southeast Asia", 105, 8],
    ["Oceania", 135, -25],
    ["South America", -60, -20],
  ];
  labels.forEach(([text, lon, lat]) => {
    const [x, y] = project(lon, lat, width, height);
    const t = makeEl("text", { x, y, class: "map-label" });
    t.textContent = text;
    svg.appendChild(t);
  });
}

function aggregateNodes(rows) {
  const key = metricKey();
  const stats = {};
  rows.forEach((row) => {
    const value = Number(row[key] || 0);
    if (!stats[row.seller]) stats[row.seller] = { in: 0, out: 0, total: 0, sources: {}, targets: {} };
    if (!stats[row.buyer]) stats[row.buyer] = { in: 0, out: 0, total: 0, sources: {}, targets: {} };
    stats[row.seller].out += value;
    stats[row.seller].total += value;
    stats[row.seller].targets[row.buyer] = (stats[row.seller].targets[row.buyer] || 0) + value;
    stats[row.buyer].in += value;
    stats[row.buyer].total += value;
    stats[row.buyer].sources[row.seller] = (stats[row.buyer].sources[row.seller] || 0) + value;
  });
  return stats;
}

function showFlowTooltip(event, row) {
  const type = classifyFlow(row.seller, row.buyer);
  const key = metricKey();
  const html = `
    <strong>${countryName(row.seller)} → ${countryName(row.buyer)}</strong><br>
    年份：${row.year}；阶段：${row.period}<br>
    时间汇总：${row.is_aggregated ? "汇总" : "不汇总"}<br>
    流向类型：${type.label}<br>
    质量口径：${cache.metadata.quality_labels[state.quality] || state.quality}<br>
    技术领域：${row.tech_id ? techName(row.tech_id) : "全部技术领域"}<br>
    交易类型：${row.transaction_type || "全部"}<br>
    交易次数：${formatNumber(row[metricKey(state.quality, "trans_times")] || 0)}<br>
    专利数量：${formatNumber(row[metricKey(state.quality, "trans_patent")] || 0)}<br>
    当前指标：${formatNumber(row[key] || 0)}
  `;
  showTooltip(event, html);
}

function showNodeTooltip(event, code, stats) {
  const topSource = topEntry(stats.sources);
  const topTarget = topEntry(stats.targets);
  const html = `
    <strong>${countryName(code)}</strong><br>
    当前筛选下流入：${formatNumber(stats.in)}<br>
    当前筛选下流出：${formatNumber(stats.out)}<br>
    净流入：${formatNumber(stats.in - stats.out)}<br>
    主要来源：${topSource ? `${countryName(topSource[0])} ${formatNumber(topSource[1])}` : "无"}<br>
    主要目的地：${topTarget ? `${countryName(topTarget[0])} ${formatNumber(topTarget[1])}` : "无"}
  `;
  showTooltip(event, html);
}

function showTooltip(event, html) {
  els.tooltip.innerHTML = html;
  els.tooltip.style.display = "block";
  const box = els.flowMap.getBoundingClientRect();
  els.tooltip.style.left = `${event.clientX - box.left + 14}px`;
  els.tooltip.style.top = `${event.clientY - box.top + 14}px`;
}

function hideTooltip() {
  els.tooltip.style.display = "none";
}

function topEntry(obj) {
  const entries = Object.entries(obj);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0];
}

function drawTable(rows, totalFiltered) {
  const tbody = els.rankingTable.querySelector("tbody");
  tbody.innerHTML = "";
  const currentTechName = state.techId === "all" ? "全部" : techName(state.techId);
  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    const type = classifyFlow(row.seller, row.buyer);
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>${row.year}</td>
      <td>${countryName(row.seller)}</td>
      <td>${countryName(row.buyer)}</td>
      <td>${type.label}</td>
      <td>${row.transaction_type || "全部"}</td>
      <td>${row.tech_id ? techName(row.tech_id) : currentTechName}</td>
      <td>${formatNumber(row[metricKey(state.quality, "trans_times")] || 0)}</td>
      <td>${formatNumber(row[metricKey(state.quality, "trans_patent")] || 0)}</td>
    `;
    tr.addEventListener("click", () => {
      state.selected = row;
      updateDetail(row, datasetKind());
    });
    tbody.appendChild(tr);
  });
  els.rowCountLabel.textContent = `筛选后 ${formatNumber(totalFiltered)} 条，地图显示 ${formatNumber(rows.length)} 条`;
}

function updateTitle(kind, displayed, filtered) {
  const sourceName = {
    base: "基础流向表",
    type: "交易类型流向表",
    tech: "技术领域流向表",
    full: "交易类型 × 技术领域流向表",
  }[kind];
  const label = `${cache.metadata.quality_labels[state.quality]} · ${state.measure === "trans_patent" ? "专利数量" : "交易次数"}`;
  const displayLabel = state.topN === "all" ? `显示全部 ${formatNumber(displayed.length)} 条` : `显示 Top ${formatNumber(displayed.length)}`;
  const aggLabel = state.timeAgg === "sum" ? "时间汇总" : "不汇总";
  els.viewTitle.textContent = "全球专利交易流向地图";
  els.viewSubtitle.innerHTML = `${sourceName}；${label}；${aggLabel}；${state.yearFrom}-${state.yearTo}；筛选后 ${formatNumber(filtered.length)} 条，${displayLabel}。`;
}

function updateDetail(row, kind) {
  if (!row) return;
  state.selected = row;
  const type = classifyFlow(row.seller, row.buyer);
  const patent = row[metricKey(state.quality, "trans_patent")] || 0;
  const times = row[metricKey(state.quality, "trans_times")] || 0;
  els.detailContent.innerHTML = `
    <strong>${countryName(row.seller)} → ${countryName(row.buyer)}</strong><br>
    年份：${row.year}；阶段：${row.period}<br>
    时间汇总：${row.is_aggregated ? "汇总" : "不汇总"}<br>
    流向类型：${type.label}<br>
    交易类型：${row.transaction_type || "全部"}<br>
    技术领域：${row.tech_id ? techName(row.tech_id) : "全部技术领域"}
    <div class="detail-kpi">
      <div><strong>${formatNumber(patent)}</strong>专利数量</div>
      <div><strong>${formatNumber(times)}</strong>交易次数</div>
    </div>
    当前来源表：${kindLabel(kind)}
  `;
  drawTrend(row, kind);
}

function kindLabel(kind) {
  return { base: "基础流向", type: "交易类型", tech: "技术领域", full: "交易类型×技术领域" }[kind];
}

function drawTrend(row, kind) {
  const svg = els.trendChart;
  clearSvg(svg);
  const width = Math.max(260, svg.getBoundingClientRect().width || 320);
  const height = Math.max(120, svg.getBoundingClientRect().height || 130);
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const rows = getTableRows(kind).filter((d) => {
    if (d.seller !== row.seller || d.buyer !== row.buyer) return false;
    if (!d.year || d.year < state.yearFrom || d.year > state.yearTo) return false;
    if (state.period !== "全部" && d.period !== state.period) return false;
    if (row.transaction_type && d.transaction_type !== row.transaction_type) return false;
    if (row.tech_id && String(d.tech_id) !== String(row.tech_id)) return false;
    return true;
  });
  const key = metricKey();
  const byYear = new Map();
  rows.forEach((d) => {
    byYear.set(d.year, (byYear.get(d.year) || 0) + Number(d[key] || 0));
  });
  const points = Array.from(byYear.entries()).sort((a, b) => a[0] - b[0]);
  if (!points.length) return;
  const pad = { left: 34, right: 12, top: 12, bottom: 24 };
  const minYear = points[0][0];
  const maxYear = points[points.length - 1][0];
  const maxVal = Math.max(...points.map((p) => p[1]), 1);
  const x = (year) => pad.left + ((year - minYear) / Math.max(1, maxYear - minYear)) * (width - pad.left - pad.right);
  const y = (value) => height - pad.bottom - (value / maxVal) * (height - pad.top - pad.bottom);
  svg.appendChild(makeEl("line", { x1: pad.left, y1: height - pad.bottom, x2: width - pad.right, y2: height - pad.bottom, stroke: "#cbd5e1" }));
  svg.appendChild(makeEl("line", { x1: pad.left, y1: pad.top, x2: pad.left, y2: height - pad.bottom, stroke: "#cbd5e1" }));
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p[0]).toFixed(1)} ${y(p[1]).toFixed(1)}`).join(" ");
  svg.appendChild(makeEl("path", { d, fill: "none", stroke: "#2563eb", "stroke-width": 2.2 }));
  points.forEach((p) => {
    svg.appendChild(makeEl("circle", { cx: x(p[0]), cy: y(p[1]), r: 2.8, fill: "#2563eb" }));
  });
  addText(svg, pad.left, height - 6, String(minYear), "11px", "#64748b");
  addText(svg, width - pad.right - 32, height - 6, String(maxYear), "11px", "#64748b");
  addText(svg, 5, pad.top + 5, formatNumber(maxVal), "11px", "#64748b");
}

function makeEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function addText(svg, x, y, text, fontSize, fill) {
  const el = makeEl("text", { x, y, "font-size": fontSize, fill });
  el.textContent = text;
  svg.appendChild(el);
}

function clearSvg(svg) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function showLoading(text) {
  if (els.viewSubtitle) els.viewSubtitle.textContent = text;
}

function applyStoredLayout() {
  const sidebar = Number(localStorage.getItem("patentFlowSidebarWidth") || 300);
  const mapHeight = Number(localStorage.getItem("patentFlowMapHeight") || 560);
  document.documentElement.style.setProperty("--sidebar-width", `${clamp(sidebar, 240, 480)}px`);
  document.documentElement.style.setProperty("--map-height", `${clamp(mapHeight, 380, 820)}px`);
}

function initResizers() {
  initSidebarResizer();
  initMapResizer();
}

function initSidebarResizer() {
  if (!els.sidebarResizer) return;
  let startX = 0;
  let startWidth = 0;
  let dragging = false;
  els.sidebarResizer.addEventListener("pointerdown", (event) => {
    dragging = true;
    startX = event.clientX;
    startWidth = currentCssPx("--sidebar-width", 300);
    els.sidebarResizer.classList.add("dragging");
    document.body.style.userSelect = "none";
    els.sidebarResizer.setPointerCapture(event.pointerId);
  });
  els.sidebarResizer.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const width = clamp(startWidth + event.clientX - startX, 240, 500);
    document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
    localStorage.setItem("patentFlowSidebarWidth", String(width));
    scheduleLayoutRender();
  });
  els.sidebarResizer.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = false;
    els.sidebarResizer.classList.remove("dragging");
    document.body.style.userSelect = "";
    els.sidebarResizer.releasePointerCapture(event.pointerId);
    render();
  });
}

function initMapResizer() {
  if (!els.mapResizer) return;
  let startY = 0;
  let startHeight = 0;
  let dragging = false;
  els.mapResizer.addEventListener("pointerdown", (event) => {
    dragging = true;
    startY = event.clientY;
    startHeight = currentCssPx("--map-height", 560);
    els.mapResizer.classList.add("dragging");
    document.body.style.userSelect = "none";
    els.mapResizer.setPointerCapture(event.pointerId);
  });
  els.mapResizer.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    const maxHeight = Math.max(420, window.innerHeight - 180);
    const height = clamp(startHeight + event.clientY - startY, 380, Math.min(860, maxHeight));
    document.documentElement.style.setProperty("--map-height", `${height}px`);
    localStorage.setItem("patentFlowMapHeight", String(height));
    scheduleLayoutRender();
  });
  els.mapResizer.addEventListener("pointerup", (event) => {
    if (!dragging) return;
    dragging = false;
    els.mapResizer.classList.remove("dragging");
    document.body.style.userSelect = "";
    els.mapResizer.releasePointerCapture(event.pointerId);
    render();
  });
}

let layoutRenderTimer = null;
function scheduleLayoutRender() {
  if (layoutRenderTimer) return;
  layoutRenderTimer = setTimeout(() => {
    layoutRenderTimer = null;
    render();
  }, 120);
}

function currentCssPx(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const number = Number(value.replace("px", ""));
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

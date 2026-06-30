# -*- coding: utf-8 -*-
"""
Prepare compact JSON data files for the local patent-flow dashboard.

The source workbooks are generated flow summaries. This script intentionally
keeps the overall flow table separate from multi-label transaction-type and
technology-field tables, so the dashboard never sums classification tables back
to totals.
"""

from __future__ import annotations

import json
import math
import os
import re
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = Path(os.environ.get("PATENT_FLOW_DASHBOARD_OUT_DIR", Path(__file__).resolve().parent / "data"))

FILES = {
    "country": ROOT / "country对应_首都经纬度和标签.xlsx",
    "base": ROOT / "买方卖方流向_技术类型统计4_基本.xlsx",
    "type": ROOT / "买方卖方流向_技术类型统计4_交易类型.xlsx",
    "tech": ROOT / "买方卖方流向_技术类型统计4_技术领域.xlsx",
    "full": ROOT / "买方卖方流向_技术类型统计4_全.xlsx",
}

QUALITY_METRICS = [
    "all",
    "hq_adj1_top25",
    "hq_adj1_top10",
    "hq_adj1_top5",
    "hq_adj1_top1",
    "hq_adj1_ge1",
]

QUALITY_LABELS = {
    "all": "全部专利",
    "hq_adj1_top25": "被引adj1前25%",
    "hq_adj1_top10": "被引adj1前10%",
    "hq_adj1_top5": "被引adj1前5%",
    "hq_adj1_top1": "被引adj1前1%",
    "hq_adj1_ge1": "被引adj1>=1",
}

SHORT_METRIC_COLS = {
    "all_trans_times": "all_times",
    "all_trans_patent": "all_patent",
    "hq_adj1_top25_trans_times": "top25_times",
    "hq_adj1_top25_trans_patent": "top25_patent",
    "hq_adj1_top10_trans_times": "top10_times",
    "hq_adj1_top10_trans_patent": "top10_patent",
    "hq_adj1_top5_trans_times": "top5_times",
    "hq_adj1_top5_trans_patent": "top5_patent",
    "hq_adj1_top1_trans_times": "top1_times",
    "hq_adj1_top1_trans_patent": "top1_patent",
    "hq_adj1_ge1_trans_times": "ge1_times",
    "hq_adj1_ge1_trans_patent": "ge1_patent",
}

TECH_COL_RE = re.compile(
    r"^(?P<quality>all|hq_adj1_top25|hq_adj1_top10|hq_adj1_top5|hq_adj1_top1|hq_adj1_ge1)"
    r"__tech(?P<tech_id>[^_]+)_(?P<safe_name>.+)"
    r"__(?P<measure>trans_times|trans_patent)$"
)


def period_from_year(year: object) -> str:
    y = pd.to_numeric(pd.Series([year]), errors="coerce").iloc[0]
    if pd.isna(y):
        return "年份缺失"
    y = int(y)
    if y < 2000:
        return "2000年前"
    if y <= 2007:
        return "2000-2007"
    if y <= 2012:
        return "2008-2012"
    if y <= 2017:
        return "2013-2017"
    if y <= 2019:
        return "2018-2019"
    if y <= 2025:
        return "2020-2025"
    return "2025年后"


def find_col(df: pd.DataFrame, candidates: list[str], fallback_index: int | None = None) -> str:
    normalized = {str(c).strip().lower(): c for c in df.columns}
    for cand in candidates:
        key = cand.strip().lower()
        if key in normalized:
            return normalized[key]
    if fallback_index is not None and fallback_index < len(df.columns):
        return str(df.columns[fallback_index])
    raise KeyError(f"Cannot find any of columns: {candidates}")


def clean_code(value: object) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip().upper()


def clean_int(value: object) -> int:
    if pd.isna(value):
        return 0
    try:
        return int(float(value))
    except Exception:
        return 0


def clean_float(value: object) -> float | None:
    if pd.isna(value):
        return None
    try:
        out = float(value)
    except Exception:
        return None
    if math.isnan(out) or math.isinf(out):
        return None
    return out


def group_from_flags(entity_flag: object, haven_flag: object) -> str:
    entity = clean_int(entity_flag) == 1
    haven = clean_int(haven_flag) == 1
    if entity:
        return "实体产业国家"
    if haven:
        return "避税地/控股节点"
    return "其他国家/地区"


def write_json(name: str, payload: object) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    path = OUT_DIR / name
    try:
        with path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    except PermissionError:
        # On some Windows-controlled folders the first write attempt to a new
        # file can fail transiently. Retry through a temp file in the same dir.
        tmp = path.with_suffix(path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        if path.exists():
            path.unlink()
        tmp.replace(path)
    print(f"Wrote {path} ({path.stat().st_size / 1024 / 1024:.2f} MB)")


def dataframe_to_table(df: pd.DataFrame, columns: list[str]) -> dict:
    work = df[columns].copy()
    for col in work.columns:
        if pd.api.types.is_float_dtype(work[col]):
            work[col] = work[col].replace({np.nan: None})
        elif work[col].dtype == "object":
            work[col] = work[col].where(pd.notna(work[col]), None)
    rows = work.to_numpy(dtype=object).tolist()
    return {"columns": columns, "rows": rows}


def load_country_mapping() -> tuple[dict, dict, dict]:
    df = pd.read_excel(FILES["country"], sheet_name=0)

    raw_col = find_col(df, ["country_code", "Raw code"], 0)
    iso_col = find_col(df, ["Adjusted country ISO code", "iso", "country_iso"], 1)
    name_col = find_col(df, ["country_name_en", "Adjusted country/region"], 2)
    capital_col = find_col(df, ["首都/行政中心", "capital"], 3)
    lon_col = find_col(df, ["lon", "经度", "longitude"], 4)
    lat_col = find_col(df, ["lat", "纬度", "latitude"], 5)
    entity_col = find_col(df, ["实体国家", "is_entity_country", "entity"], 6)
    haven_col = find_col(df, ["国际避税地", "is_tax_haven", "haven"], 7)

    countries: dict[str, dict] = {}
    raw_to_display: dict[str, str] = {}
    missing_coords = []

    for _, row in df.iterrows():
        raw_code = clean_code(row[raw_col])
        if not raw_code:
            continue
        iso = clean_code(row[iso_col])
        display_code = raw_code if not iso or iso == "UNRESOLVED" else iso
        lon = clean_float(row[lon_col])
        lat = clean_float(row[lat_col])
        entity = clean_int(row[entity_col])
        haven = clean_int(row[haven_col])
        group = group_from_flags(row[entity_col], row[haven_col])
        raw_to_display[raw_code] = display_code

        candidate = {
            "code": display_code,
            "iso": iso,
            "name_en": "" if pd.isna(row[name_col]) else str(row[name_col]).strip(),
            "name_cn": "" if pd.isna(row[name_col]) else str(row[name_col]).strip(),
            "capital": "" if pd.isna(row[capital_col]) else str(row[capital_col]).strip(),
            "lon": lon,
            "lat": lat,
            "entity": entity,
            "haven": haven,
            "group": group,
            "region": group,
            "raw_codes": [raw_code],
        }

        if display_code not in countries:
            countries[display_code] = candidate
        else:
            current = countries[display_code]
            current["raw_codes"].append(raw_code)
            current["entity"] = 1 if current["entity"] == 1 or entity == 1 else 0
            current["haven"] = 1 if current["haven"] == 1 or haven == 1 else 0
            current["group"] = group_from_flags(current["entity"], current["haven"])
            current["region"] = current["group"]
            if current["lon"] is None and lon is not None:
                current["lon"] = lon
            if current["lat"] is None and lat is not None:
                current["lat"] = lat
            if not current["name_en"] and candidate["name_en"]:
                current["name_en"] = candidate["name_en"]
            if not current["capital"] and candidate["capital"]:
                current["capital"] = candidate["capital"]

        if lon is None or lat is None:
            missing_coords.append(candidate)

    meta = {
        "source_file": str(FILES["country"]),
        "field_mapping": {
            "country_code": raw_col,
            "country_iso": iso_col,
            "country_name": name_col,
            "capital": capital_col,
            "lon": lon_col,
            "lat": lat_col,
            "entity": entity_col,
            "haven": haven_col,
        },
        "raw_country_code_count": len(raw_to_display),
        "display_country_count": len(countries),
        "missing_coord_count": len(missing_coords),
        "missing_coords": missing_coords,
    }
    return countries, raw_to_display, meta


def prepare_flow_table(df: pd.DataFrame, raw_to_display: dict[str, str], has_type: bool = False) -> pd.DataFrame:
    year_col = str(df.columns[0])
    base_cols = [year_col, "saller_country", "buyer_country"]
    if has_type:
        base_cols.append("transaction_type")

    required = base_cols + list(SHORT_METRIC_COLS.keys())
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {missing}")

    out = df[required].copy()
    out = out.rename(columns={year_col: "year", **SHORT_METRIC_COLS})
    out["year"] = pd.to_numeric(out["year"], errors="coerce").fillna(0).astype("int64")
    out["period"] = out["year"].map(period_from_year)
    out["seller"] = out["saller_country"].map(clean_code).map(lambda x: raw_to_display.get(x, x))
    out["buyer"] = out["buyer_country"].map(clean_code).map(lambda x: raw_to_display.get(x, x))
    out = out.drop(columns=["saller_country", "buyer_country"])
    if has_type:
        out["transaction_type"] = out["transaction_type"].astype("string").str.strip().fillna("")

    metric_short_cols = list(SHORT_METRIC_COLS.values())
    out[metric_short_cols] = out[metric_short_cols].fillna(0).astype("int64")

    ordered = ["year", "period", "seller", "buyer"]
    if has_type:
        ordered.append("transaction_type")
    ordered += metric_short_cols
    out = out[ordered]

    group_cols = ["year", "period", "seller", "buyer"]
    if has_type:
        group_cols.append("transaction_type")
    out = out.groupby(group_cols, dropna=False, as_index=False)[metric_short_cols].sum()
    return out[ordered]


def load_tech_reference() -> tuple[pd.DataFrame, list[dict]]:
    ref = pd.read_excel(FILES["tech"], sheet_name=1)
    ref["tech_field_id"] = ref["tech_field_id"].astype(str)
    ref["safe_tech_field_name"] = ref["safe_tech_field_name"].astype(str)
    ref["tech_field_name_en"] = ref["tech_field_name_en"].astype(str)
    records = []
    for _, row in ref.iterrows():
        records.append(
            {
                "tech_id": str(row["tech_field_id"]),
                "tech_area_id": "" if pd.isna(row.get("tech_area_id")) else str(row.get("tech_area_id")),
                "tech_area_en": "" if pd.isna(row.get("tech_area_en")) else str(row.get("tech_area_en")),
                "name": str(row["tech_field_name_en"]),
                "safe_name": str(row["safe_tech_field_name"]),
                "is_others": bool(row.get("是否为others领域", False)),
            }
        )
    return ref, records


def tech_metric_columns_for(tech_id: str, safe_name: str) -> dict[str, str]:
    cols: dict[str, str] = {}
    for q in QUALITY_METRICS:
        for measure in ["trans_times", "trans_patent"]:
            source = f"{q}__tech{tech_id}_{safe_name}__{measure}"
            suffix = "times" if measure == "trans_times" else "patent"
            metric_key = {
                "all": "all",
                "hq_adj1_top25": "top25",
                "hq_adj1_top10": "top10",
                "hq_adj1_top5": "top5",
                "hq_adj1_top1": "top1",
                "hq_adj1_ge1": "ge1",
            }[q]
            cols[source] = f"{metric_key}_{suffix}"
    return cols


def prepare_sparse_tech_table(
    df: pd.DataFrame,
    ref: pd.DataFrame,
    raw_to_display: dict[str, str],
    has_type: bool = False,
) -> pd.DataFrame:
    year_col = str(df.columns[0])
    keys = [year_col, "saller_country", "buyer_country"]
    if has_type:
        keys.append("transaction_type")

    pieces = []
    metric_short_cols = list(SHORT_METRIC_COLS.values())
    for _, tech in ref.iterrows():
        tech_id = str(tech["tech_field_id"])
        safe_name = str(tech["safe_tech_field_name"])
        source_to_short = tech_metric_columns_for(tech_id, safe_name)
        available = [c for c in source_to_short if c in df.columns]
        if not available:
            continue
        sub = df[keys + available].copy()
        short_cols = [source_to_short[c] for c in available]
        sub = sub.rename(columns={year_col: "year", **{c: source_to_short[c] for c in available}})
        sub[short_cols] = sub[short_cols].fillna(0).astype("int64")
        for col in metric_short_cols:
            if col not in sub.columns:
                sub[col] = 0
        mask = sub[metric_short_cols].sum(axis=1) > 0
        if not mask.any():
            continue
        sub = sub.loc[mask].copy()
        sub["period"] = pd.to_numeric(sub["year"], errors="coerce").fillna(0).astype("int64").map(period_from_year)
        sub["seller"] = sub["saller_country"].map(clean_code).map(lambda x: raw_to_display.get(x, x))
        sub["buyer"] = sub["buyer_country"].map(clean_code).map(lambda x: raw_to_display.get(x, x))
        sub["tech_id"] = tech_id
        sub = sub.drop(columns=["saller_country", "buyer_country"])
        if has_type:
            sub["transaction_type"] = sub["transaction_type"].astype("string").str.strip().fillna("")
        ordered = ["year", "period", "seller", "buyer"]
        if has_type:
            ordered.append("transaction_type")
        ordered.append("tech_id")
        ordered += metric_short_cols
        pieces.append(sub[ordered])

    if not pieces:
        columns = ["year", "period", "seller", "buyer"]
        if has_type:
            columns.append("transaction_type")
        columns.append("tech_id")
        columns += metric_short_cols
        return pd.DataFrame(columns=columns)
    out = pd.concat(pieces, ignore_index=True)
    group_cols = ["year", "period", "seller", "buyer"]
    if has_type:
        group_cols.append("transaction_type")
    group_cols.append("tech_id")
    out = out.groupby(group_cols, dropna=False, as_index=False)[metric_short_cols].sum()
    return out[group_cols + metric_short_cols]


def flow_code_diagnostics(base: pd.DataFrame, countries: dict[str, dict]) -> dict:
    codes = set(base["seller"].dropna().astype(str)) | set(base["buyer"].dropna().astype(str))
    missing_mapping = sorted(c for c in codes if c not in countries)
    missing_coords = sorted(
        c
        for c in codes
        if c in countries and (countries[c]["lon"] is None or countries[c]["lat"] is None)
    )
    return {
        "flow_country_count": len(codes),
        "missing_mapping": missing_mapping,
        "missing_coords_in_flows": missing_coords,
    }


def main() -> None:
    for label, path in FILES.items():
        if not path.exists():
            raise FileNotFoundError(f"Missing {label} file: {path}")

    print("Loading country mapping...")
    countries, raw_to_display, country_meta = load_country_mapping()

    print("Loading base flow...")
    base_raw = pd.read_excel(FILES["base"], sheet_name=0)
    base = prepare_flow_table(base_raw, raw_to_display, has_type=False)

    print("Loading transaction-type flow...")
    type_raw = pd.read_excel(FILES["type"], sheet_name=0)
    type_flow = prepare_flow_table(type_raw, raw_to_display, has_type=True)

    print("Loading technology reference...")
    tech_ref, tech_records = load_tech_reference()

    print("Loading technology wide flow and converting to sparse long table...")
    tech_raw = pd.read_excel(FILES["tech"], sheet_name=0)
    tech_flow = prepare_sparse_tech_table(tech_raw, tech_ref, raw_to_display, has_type=False)

    print("Loading transaction-type by technology wide flow and converting to sparse long table...")
    full_raw = pd.read_excel(FILES["full"], sheet_name=0)
    full_flow = prepare_sparse_tech_table(full_raw, tech_ref, raw_to_display, has_type=True)

    diagnostics = {
        "source_files": {k: str(v) for k, v in FILES.items()},
        "country": country_meta,
        "country_aggregation": "Flow country codes are mapped from Raw code to Adjusted country ISO code before web visualization.",
        "flow_codes": flow_code_diagnostics(base, countries),
        "row_counts": {
            "base": len(base),
            "type": len(type_flow),
            "tech_sparse": len(tech_flow),
            "full_sparse": len(full_flow),
        },
        "year_range": {
            "min": int(base["year"].min()) if len(base) else None,
            "max": int(base["year"].max()) if len(base) else None,
        },
        "default_metric": "hq_adj1_top10_trans_patent",
        "notes": [
            "Transaction type and technology field tables are multi-label classification views.",
            "They must not be summed to reconstruct the overall flow; use base_flow for totals.",
        ],
    }

    print("Writing JSON data...")
    write_json("country_mapping.json", {"countries": countries})
    write_json(
        "metadata.json",
        {
            "quality_metrics": QUALITY_METRICS,
            "quality_labels": QUALITY_LABELS,
            "metric_columns": {
                "all": {"trans_times": "all_times", "trans_patent": "all_patent"},
                "hq_adj1_top25": {"trans_times": "top25_times", "trans_patent": "top25_patent"},
                "hq_adj1_top10": {"trans_times": "top10_times", "trans_patent": "top10_patent"},
                "hq_adj1_top5": {"trans_times": "top5_times", "trans_patent": "top5_patent"},
                "hq_adj1_top1": {"trans_times": "top1_times", "trans_patent": "top1_patent"},
                "hq_adj1_ge1": {"trans_times": "ge1_times", "trans_patent": "ge1_patent"},
            },
            "periods": ["全部", "2000年前", "2000-2007", "2008-2012", "2013-2017", "2018-2019", "2020-2025"],
            "transaction_types": sorted(type_flow["transaction_type"].dropna().unique().tolist()),
        },
    )
    write_json("tech_field_reference.json", {"tech_fields": tech_records})
    write_json("base_flow.json", dataframe_to_table(base, list(base.columns)))
    write_json("type_flow.json", dataframe_to_table(type_flow, list(type_flow.columns)))
    write_json("tech_flow.json", dataframe_to_table(tech_flow, list(tech_flow.columns)))
    write_json("full_flow.json", dataframe_to_table(full_flow, list(full_flow.columns)))
    write_json("diagnostics.json", diagnostics)

    print("Done.")
    print(json.dumps(diagnostics["row_counts"], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

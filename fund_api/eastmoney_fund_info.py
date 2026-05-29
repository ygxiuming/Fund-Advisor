"""
东方财富/天天基金接口封装模块。

本模块整合了 favor.fund.eastmoney.com 页面实际使用的一批公开接口，
支持按基金代码、名称或简拼查询基金信息，也支持查询推荐基金、收益排行、
基金吧帖子、盘中估值、净值走势图以及指数/ETF/场内基金行情。

说明：
- 仅使用 Python 标准库，不依赖 requests 等第三方库。
- 公开数据接口无需加密参数；页面里的 encryption.min.js 主要用于部分
  实时推送 cookie、登录跳转参数等场景。
- 东方财富接口字段大多是字符串，即使看起来是数字，也建议调用方按需转换。
"""

from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from typing import Any, Iterable


SEARCH_URL = "https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx"
INFO_URL = "https://api.fund.eastmoney.com/favor/GetFundsInfo?"
RECOMMEND_URL = "https://api.fund.eastmoney.com/favor/GetRecommendNew?"
RANK_URL = "https://api.fund.eastmoney.com/favor/ranknew"
JJB_URL = "https://api.fund.eastmoney.com/favor/jjbNew?"
FUND_ICON_URL = "https://api.fund.eastmoney.com/favor/GetHTPNew?"
FUND_CHART_URL = "https://api.fund.eastmoney.com/FAvor/FundChart"
FUND_GZ_URL_TEMPLATE = "https://fundgz.1234567.com.cn/js/{fund_code}.js"
QUOTE_URL = "https://push2.eastmoney.com/api/qt/ulist.np/get"
QUOTE_MODULE_CONFIG_URL = "https://api.fund.eastmoney.com/favor/GetModuleConfig"


DEFAULT_TIMEOUT = 10.0


FUND_DETAIL_TYPES: dict[str, str] = {
    "KFS": "开放式基金",
    "HBX": "货币基金",
    "LCX": "理财基金",
    "CN": "场内基金",
    "HK": "海外基金",
    "GD": "高端产品",
}


QUOTE_FIELD_DESCRIPTIONS: dict[str, str] = {
    "f1": "市场/交易状态字段。",
    "f2": "最新价或最新点位。",
    "f3": "涨跌幅，单位为百分比。",
    "f4": "涨跌额。",
    "f7": "振幅，单位为百分比。",
    "f8": "换手率或相关比例字段，具体含义随证券类型变化。",
    "f12": "行情代码。",
    "f13": "市场编号，常见 1 为上交所，0 为深交所，100 为海外指数。",
    "f14": "证券/指数名称。",
    "f15": "最高价或最高点位。",
    "f16": "最低价或最低点位。",
    "f17": "今开价或开盘点位。",
    "f18": "昨收价或昨收点位。",
}


FIELD_DESCRIPTIONS: dict[str, str] = {
    "query": "原始查询关键字，可以是基金代码、名称或简拼。",
    "resolved_code": "最终用于查询详情的基金代码。后端/申购等特殊代码会按 BACKCODE 转为主基金代码。",
    "matched": "搜索接口选中的基金候选项。",
    "candidates": "搜索接口返回的候选基金列表，便于处理重名或简拼多命中。",
    "detail": "GetFundsInfo 返回并按 resolved_code 过滤后的基金详情。",
    "detail_type": "基金详情所在分类：KFS 开放式，HBX 货币，LCX 理财，CN 场内，HK 海外，GD 高端。",
    "raw": "原始接口响应，包含接口全部返回数据。",
    "FCODE": "基金代码。",
    "SHORTNAME": "基金简称。",
    "ISHOT": "是否热门标记，接口常为空字符串。",
    "ISBUY": "是否支持购买，布尔值或空值。",
    "DTZT": "是否支持定投，常见 1 表示支持。",
    "DWJZ": "单位净值；货币基金场景可能表示万份收益。",
    "LJJZ": "累计净值；货币基金场景可能表示 7 日年化收益率。",
    "FUNDTYPE": "基金类型编码，例：000 指数型、001 股票型、002 混合型、003 债券型、005 货币型、007 QDII、009 FOF、010 商品、011 REITs。",
    "FTYPE": "基金类型中文描述。",
    "RZDE": "日增长值。",
    "RZDF": "日增长率，百分比数值字符串。",
    "FSRQ": "净值日期。",
    "IPESTART1": "开放申购开始时间。",
    "IPEEND1": "开放申购结束时间。",
    "SHIPESTART1": "开放赎回开始时间。",
    "SHIPEEND1": "开放赎回结束时间。",
    "ISSALES": "销售状态标记，常见 1 表示可销售。",
    "TradeBuyType": "交易购买业务类型编码。",
    "gsz": "盘中估算净值。",
    "gszzl": "盘中估算涨跌幅，百分比数值字符串。",
    "Order": "自选排序值；未登录或默认推荐通常为 2147483647。",
    "SGZT": "申购状态中文描述。",
    "SYL_LN": "成立以来收益率，百分比数值字符串。",
    "RSFUNDTYPE": "推荐/分类用基金类型编码。",
    "CODE": "搜索接口基金代码。",
    "NAME": "搜索接口基金名称。",
    "JP": "基金名称简拼。",
    "BACKCODE": "主基金代码；申购、后端等特殊代码可能映射到主代码。",
    "FundBaseInfo": "搜索接口携带的基金基础信息。",
    "ZTJJInfo": "搜索接口携带的主题基金/行业主题信息。",
}


class EastmoneyFundError(RuntimeError):
    """东方财富接口返回错误、无数据或返回内容无法解析时抛出。"""


def search_funds(keyword: str, *, timeout: float = DEFAULT_TIMEOUT) -> list[dict[str, Any]]:
    """
    按基金代码、中文名称或简拼搜索基金。

    参数：
    - keyword：搜索关键字。例如 `007300`、`国联安中证半导体ETF联接A`、`GLAZZBDTETFLJA`。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - 搜索候选列表。每个元素通常包含 `CODE`、`NAME`、`JP`、`BACKCODE`、
      `FundBaseInfo`、`ZTJJInfo` 等字段。

    注意：
    - 搜索接口可能返回多只基金，调用方可以使用 `choose_best_match`
      选出最匹配的一只，或自行让用户选择。
    """
    keyword = keyword.strip()
    if not keyword:
        raise ValueError("keyword 不能为空")

    params = urllib.parse.urlencode({"callback": "", "m": "1", "key": keyword})
    data = _get_json(f"{SEARCH_URL}?{params}", timeout=timeout)
    _ensure_success(data, "搜索接口")
    return data.get("Datas") or []


def choose_best_match(keyword: str, candidates: list[dict[str, Any]]) -> dict[str, Any] | None:
    """
    从搜索候选里挑出最适合继续查询详情的一只基金。

    参数：
    - keyword：用户原始输入。
    - candidates：`search_funds` 返回的候选列表。

    返回：
    - 匹配到的候选基金字典；如果候选列表为空则返回 `None`。

    匹配规则：
    1. 优先精确匹配 `CODE`、`BACKCODE`、`_id`。
    2. 然后精确匹配 `NAME` 或 `JP`。
    3. 如果都不精确匹配，则返回搜索接口排序第一的候选。
    """
    if not candidates:
        return None

    normalized = keyword.strip().upper()
    for item in candidates:
        if normalized in {
            str(item.get("CODE", "")).upper(),
            str(item.get("BACKCODE", "")).upper(),
            str(item.get("_id", "")).upper(),
        }:
            return item

    for item in candidates:
        if normalized in {
            str(item.get("NAME", "")).upper(),
            str(item.get("JP", "")).upper(),
        }:
            return item

    return candidates[0]


def resolve_fund_code(keyword: str, *, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """
    将基金代码、中文名称或简拼解析为可用于详情接口的主基金代码。

    参数：
    - keyword：基金代码、名称或简拼。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - `query`：原始输入。
    - `resolved_code`：最终解析出的基金代码，优先取搜索结果的 `BACKCODE`。
    - `matched`：被选中的搜索候选。
    - `candidates`：所有搜索候选。

    适用场景：
    - 后续调用详情、推荐、排行、估值、图表等接口前，先把模糊输入转成基金代码。
    """
    candidates = search_funds(keyword, timeout=timeout)
    matched = choose_best_match(keyword, candidates)
    if not matched:
        raise EastmoneyFundError(f"未找到基金：{keyword}")

    code = str(matched.get("BACKCODE") or matched.get("CODE") or matched.get("_id"))
    return {
        "query": keyword,
        "resolved_code": code,
        "matched": matched,
        "candidates": candidates,
    }


def get_funds_info(fund_codes: str | Iterable[str], *, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """
    批量获取基金详情，直接封装 `favor/GetFundsInfo` 接口。

    参数：
    - fund_codes：基金代码字符串或代码列表。列表会自动拼成英文逗号分隔。
      例如 `007300` 或 `["007300", "000001"]`。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - 接口原始 JSON 字典，主要数据位于 `Data.KFS/HBX/LCX/CN/HK/GD`。

    注意：
    - 即使只传一个基金代码，接口也可能额外返回推荐基金。
    - 如果只需要目标基金，请使用 `get_fund_detail` 或 `get_fund_all_info`，
      它们会按 `FCODE` 做二次过滤。
    """
    codes = _join_codes(fund_codes)
    data = _post_form(INFO_URL, {"fcodes": codes}, timeout=timeout)
    _ensure_success(data, "基金详情接口")
    return data


def get_fund_detail(keyword: str, *, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """
    查询单只基金详情，并过滤掉接口夹带的推荐基金。

    参数：
    - keyword：基金代码、名称或简拼。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - `query`：原始输入。
    - `resolved_code`：解析后的基金代码。
    - `detail_type`：详情所属分类，例如 `KFS`。
    - `detail_type_name`：分类中文名。
    - `detail`：目标基金详情字段。
    - `matched`：搜索命中的候选。
    - `candidates`：搜索候选列表。
    - `raw`：详情接口原始响应。
    """
    resolved = resolve_fund_code(keyword, timeout=timeout)
    code = resolved["resolved_code"]
    raw = get_funds_info(code, timeout=timeout)
    detail_type, detail = _extract_detail(raw, code)
    if detail is None:
        raise EastmoneyFundError(f"详情接口未返回目标基金：{code}")

    return {
        **resolved,
        "detail_type": detail_type,
        "detail_type_name": FUND_DETAIL_TYPES.get(detail_type or "", ""),
        "detail": detail,
        "raw": raw,
    }


def get_fund_all_info(keyword: str, *, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """
    查询单只基金在自选页接口可取得的全部核心信息。

    参数：
    - keyword：基金代码、名称或简拼。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - 在 `get_fund_detail` 的返回结构基础上，额外附带 `field_descriptions`
      字段说明，方便调用方理解东方财富字段含义。

    兼容性：
    - 这是最早提供的入口函数，保留给已有调用代码继续使用。
    """
    result = get_fund_detail(keyword, timeout=timeout)
    result["field_descriptions"] = FIELD_DESCRIPTIONS
    return result


def get_recommended_funds(
    fund_codes: str | Iterable[str],
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """
    获取“你可能感兴趣/推荐基金”列表。

    参数：
    - fund_codes：参考基金代码，可以是一只或多只。例如 `007300`。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - 接口原始 JSON。推荐基金列表位于 `Data`。
    - 常见字段：`FCODE`、`SHORTNAME`、`SYL_3Y`、`SYL_1N`、`ISAddFavor`。

    说明：
    - 该接口不需要登录。
    - 推荐逻辑由东方财富后端决定，调用方只负责传入参考基金代码。
    """
    data = _post_form(RECOMMEND_URL, {"fcodes": _join_codes(fund_codes)}, timeout=timeout)
    _ensure_success(data, "推荐基金接口")
    return data


def get_fund_rank(
    fund_codes: str | Iterable[str],
    *,
    gid: str = "",
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """
    获取指定基金集合的阶段收益排行数据。

    参数：
    - fund_codes：基金代码或基金代码列表。
    - gid：自定义分组 ID。未使用分组时传空字符串即可。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - 接口原始 JSON。排行列表位于 `Data`。
    - 常见字段：`SYL_Z` 近一周、`SYL_Y` 近一月、`SYL_3Y` 近三月、
      `SYL_6Y` 近六月、`SYL_JN` 今年来、`SYL_1N` 近一年、
      `SYL_2N` 近两年、`SYL_3N` 近三年、`SYL_5N` 近五年、
      `SYL_LN` 成立以来。
    """
    data = _post_form(RANK_URL, {"fcodes": _join_codes(fund_codes), "gid": gid}, timeout=timeout)
    _ensure_success(data, "基金排行接口")
    return data


def get_fund_bar_posts(
    fund_codes: str | Iterable[str],
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """
    获取基金吧相关帖子列表。

    参数：
    - fund_codes：基金代码或基金代码列表。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - 接口原始 JSON。帖子列表位于 `Data`。
    - 常见字段：`post_title` 帖子标题、`post_last_time` 最近回复时间、
      `post_id` 帖子 ID、`FCODE` 基金代码、`SHORTNAME` 基金简称。

    说明：
    - 这是页面右侧“基金吧”模块使用的接口，不需要登录。
    """
    data = _post_form(JJB_URL, {"fcodes": _join_codes(fund_codes)}, timeout=timeout)
    _ensure_success(data, "基金吧接口")
    return data


def get_fund_icons(
    fund_codes: str | Iterable[str],
    *,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """
    获取基金热门/提示图标信息。

    参数：
    - fund_codes：基金代码或基金代码列表。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - 接口原始 JSON。图标/提示信息位于 `Data`。
    - 常见字段：`FCODE`、`ISHOT`、`CCZB`、`Tips`。

    说明：
    - 该接口通常用于页面展示角标、提示等辅助信息。
    """
    data = _post_form(FUND_ICON_URL, {"fcodes": _join_codes(fund_codes)}, timeout=timeout)
    _ensure_success(data, "基金图标接口")
    return data


def get_fund_chart(
    fund_code: str,
    *,
    fund_type: str = "kfs",
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """
    获取基金净值走势图和累计收益走势图。

    参数：
    - fund_code：基金代码，例如 `007300`。
    - fund_type：基金分类。常见值：
      `kfs` 开放式基金、`hbx` 货币基金、`lcx` 理财、`hk` 海外基金。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - 接口原始 JSON。
    - `Data.LeftChart.Datas`：左图数据，通常是单位净值走势。
    - `Data.RightChart.Datas`：右图数据，通常是累计收益走势。
    - `Data.FundInfo`：当前净值、涨幅、评分等。
    - `Data.ListTopic`：相关主题/板块。
    """
    params = urllib.parse.urlencode({"fcode": fund_code, "type": fund_type})
    data = _get_json(f"{FUND_CHART_URL}?{params}", timeout=timeout)
    _ensure_success(data, "基金走势图接口")
    return data


def get_fund_estimate(fund_code: str, *, timeout: float = DEFAULT_TIMEOUT) -> dict[str, Any]:
    """
    获取开放式基金盘中估值。

    参数：
    - fund_code：基金代码，例如 `007300`。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - JSONP 内部的估值字典。
    - 常见字段：`fundcode` 基金代码、`name` 基金名称、`jzrq` 净值日期、
      `dwjz` 最近单位净值、`gsz` 估算净值、`gszzl` 估算涨跌幅、
      `gztime` 估值时间。

    注意：
    - 该接口返回的是 `jsonpgz({...});` 形式，模块内部会自动解析为字典。
    - 不是所有基金都有盘中估值数据。
    """
    url = FUND_GZ_URL_TEMPLATE.format(fund_code=fund_code)
    return _get_json(url, timeout=timeout)


def get_default_quote_secids(*, timeout: float = DEFAULT_TIMEOUT) -> list[str]:
    """
    获取自选基金页面默认展示的市场行情 secids。

    参数：
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - secid 字符串列表。例如：
      `1.000001` 上证指数、`1.000300` 沪深300、`0.399001` 深证成指、
      `0.399006` 创业板指、`100.HSI` 恒生指数等。

    用途：
    - 可直接把返回值传给 `get_market_quotes` 查询行情快照。
    """
    params = urllib.parse.urlencode({"type": "1"})
    data = _get_json(f"{QUOTE_MODULE_CONFIG_URL}?{params}", timeout=timeout)
    _ensure_success(data, "默认行情配置接口")
    return data.get("Data") or []


def get_market_quotes(
    secids: str | Iterable[str],
    *,
    fields: str | Iterable[str] | None = None,
    timeout: float = DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """
    获取指数、ETF、场内基金等市场行情快照。

    参数：
    - secids：东方财富行情 secid 或 secid 列表。例：
      `1.000001` 上证指数、`0.399001` 深证成指、`1.512480` 上交所 ETF。
    - fields：需要返回的行情字段。默认使用页面脚本中的字段：
      `f1,f2,f3,f4,f7,f8,f12,f13,f14,f15,f16,f17,f18`。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - 东方财富行情接口原始 JSON。行情列表位于 `data.diff`。

    常见字段：
    - `f2` 最新价/点位，`f3` 涨跌幅，`f4` 涨跌额，`f12` 代码，
      `f13` 市场编号，`f14` 名称，`f15` 最高，`f16` 最低，
      `f17` 今开，`f18` 昨收。
    """
    if fields is None:
        fields_text = "f1,f2,f3,f4,f7,f8,f12,f13,f14,f15,f16,f17,f18"
    else:
        fields_text = _join_codes(fields)

    params = urllib.parse.urlencode(
        {
            "fltt": "2",
            "fields": fields_text,
            "ut": "267f9ad526dbe6b0262ab19316f5a25b",
            "invt": "2",
            "secids": _join_codes(secids),
        }
    )
    data = _get_json(f"{QUOTE_URL}?{params}", timeout=timeout)
    if data.get("rc") != 0:
        raise EastmoneyFundError(f"行情接口错误：rc={data.get('rc')}")
    return data


def build_stock_secid(code: str, *, market: str | None = None) -> str:
    """
    根据 A 股/ETF/指数代码生成东方财富行情 secid。

    参数：
    - code：证券或指数代码，例如 `000001`、`399001`、`512480`。
    - market：可选市场前缀。传 `sh`/`1` 强制上交所，传 `sz`/`0` 强制深交所。

    返回：
    - secid 字符串。例如 `1.000001`、`0.399001`、`1.512480`。

    自动判断规则：
    - `5`、`6`、`9` 开头通常按上交所 `1`。
    - `0`、`1`、`2`、`3` 开头通常按深交所 `0`。
    - 指数代码 `000001` 在行情里常用于上证指数，因此自动归为 `1.000001`。
    """
    code = code.strip()
    if not code:
        raise ValueError("code 不能为空")

    if market is not None:
        normalized_market = market.lower()
        if normalized_market in {"sh", "1"}:
            return f"1.{code}"
        if normalized_market in {"sz", "0"}:
            return f"0.{code}"
        raise ValueError("market 只支持 sh/1 或 sz/0")

    if code == "000001" or code.startswith(("5", "6", "9")):
        return f"1.{code}"
    return f"0.{code}"


def get_quote_field_descriptions() -> dict[str, str]:
    """
    返回行情接口字段说明。

    返回：
    - 字段说明字典，键为 `f1`、`f2` 等东方财富行情字段名。

    用途：
    - 调试或对外输出行情接口数据时，可以把该说明一起返回给调用方。
    """
    return dict(QUOTE_FIELD_DESCRIPTIONS)


def get_fund_field_descriptions() -> dict[str, str]:
    """
    返回基金搜索/详情接口字段说明。

    返回：
    - 字段说明字典，包含基金详情字段、搜索字段以及模块返回结构字段。

    用途：
    - 适合在接口文档、调试输出或 API 响应中附带说明。
    """
    return dict(FIELD_DESCRIPTIONS)


def _extract_detail(raw: dict[str, Any], code: str) -> tuple[str | None, dict[str, Any] | None]:
    """
    从 `GetFundsInfo` 原始响应中按基金代码提取目标基金详情。

    参数：
    - raw：`get_funds_info` 返回的原始 JSON。
    - code：目标基金代码。

    返回：
    - `(detail_type, detail)` 二元组。
    - 如果没有找到目标基金，返回 `(None, None)`。
    """
    data = raw.get("Data") or {}
    for detail_type in ("KFS", "HBX", "LCX", "CN", "HK"):
        for item in data.get(detail_type) or []:
            if str(item.get("FCODE")) == code:
                return detail_type, item

    gd = data.get("GD")
    if isinstance(gd, list):
        for item in gd:
            if str(item.get("FCODE")) == code:
                return "GD", item
    elif isinstance(gd, dict) and str(gd.get("FCODE")) == code:
        return "GD", gd

    return None, None


def _get_json(url: str, *, timeout: float) -> dict[str, Any]:
    """
    发起 GET 请求并解析 JSON 或 JSONP。

    参数：
    - url：完整请求地址。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - 解析后的 Python 字典。

    说明：
    - 东方财富部分接口返回标准 JSON，部分接口返回 `callback({...})` JSONP。
      本函数统一交给 `_loads_json_or_jsonp` 处理。
    """
    req = urllib.request.Request(url, headers=_default_headers())
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8-sig")
    return _loads_json_or_jsonp(text)


def _post_form(url: str, data: dict[str, str], *, timeout: float) -> dict[str, Any]:
    """
    发起 `application/x-www-form-urlencoded` POST 请求并解析响应。

    参数：
    - url：完整请求地址。
    - data：表单参数字典。
    - timeout：HTTP 请求超时时间，单位秒。

    返回：
    - 解析后的 Python 字典。

    说明：
    - favor 页面里的推荐、排行、基金吧、详情等接口都采用这种 POST 表单形式。
    """
    body = urllib.parse.urlencode(data).encode("utf-8")
    headers = _default_headers()
    headers.update(
        {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Origin": "https://favor.fund.eastmoney.com",
        }
    )
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        text = resp.read().decode("utf-8-sig")
    return _loads_json_or_jsonp(text)


def _loads_json_or_jsonp(text: str) -> dict[str, Any]:
    """
    解析标准 JSON 或 JSONP 字符串。

    参数：
    - text：接口返回文本。

    返回：
    - 解析后的 Python 字典。

    支持示例：
    - `{"ErrCode":0,"Data":[]}`
    - `jsonpgz({"fundcode":"007300"});`
    - `callback({...})`
    """
    text = text.strip()
    if text.startswith("{"):
        return json.loads(text)

    match = re.match(r"^[\w$]+\((.*)\)\s*;?$", text, re.S)
    if not match:
        raise EastmoneyFundError(f"无法解析接口返回：{text[:120]}")
    return json.loads(match.group(1))


def _join_codes(values: str | Iterable[str]) -> str:
    """
    将字符串或字符串列表统一转换为英文逗号分隔字符串。

    参数：
    - values：单个字符串，或字符串可迭代对象。

    返回：
    - 英文逗号分隔后的字符串。

    说明：
    - 多个东方财富接口都使用 `fcodes=007300,000001` 或
      `secids=1.000001,0.399001` 这种形式。
    """
    if isinstance(values, str):
        return values
    return ",".join(str(item) for item in values)


def _ensure_success(data: dict[str, Any], api_name: str) -> None:
    """
    检查东方财富基金接口是否返回成功。

    参数：
    - data：接口响应字典。
    - api_name：接口名称，用于错误信息。

    返回：
    - 成功时不返回内容。

    异常：
    - 当 `ErrCode` 存在且不等于 0 时抛出 `EastmoneyFundError`。
    """
    if "ErrCode" in data and data.get("ErrCode") != 0:
        raise EastmoneyFundError(f"{api_name}错误：{data.get('ErrMsg')}")


def _default_headers() -> dict[str, str]:
    """
    构造东方财富接口常用请求头。

    返回：
    - HTTP 请求头字典。

    说明：
    - 公开接口通常不强依赖复杂请求头，但保留 `Referer` 和浏览器 UA
      可以更接近页面真实请求，减少被接口拒绝的概率。
    """
    return {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://favor.fund.eastmoney.com/",
    }


if __name__ == "__main__":
    # 简单命令行自测：直接运行本文件时，打印 007300 的核心详情和推荐基金。
    fund = get_fund_all_info("007300")
    recommend = get_recommended_funds(fund["resolved_code"])
    print(json.dumps(fund["detail"], ensure_ascii=False, indent=2))
    print(json.dumps(recommend["Data"], ensure_ascii=False, indent=2))

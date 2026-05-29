# favor.fund.eastmoney.com 接口梳理

页面脚本：

- `https://j5.dfcfw.com/sc/js/favor/common_20250427.js`
- `https://j5.dfcfw.com/sc/js/favor/index_202504271433.js?v=20250425`
- `https://j5.dfcfw.com/sc/js/favor/encryption.min.js`

结论：`encryption.min.js` 里有 MD5/AES 和 `encrypt(codes)`，主要用于估值 SSE/cookie、部分登录跳转参数；下面这些公开数据接口不需要签名或加密，只需要正常 `Referer`/`User-Agent` 即可。

## 基金检索与详情

### 基金搜索

```http
GET https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?callback=&m=1&key=007300
```

可输入基金代码、中文名、简拼。返回字段：

- `CODE`：命中的代码
- `NAME`：基金名称
- `JP`：简拼
- `BACKCODE`：主基金代码，后端/申购等特殊代码会映射到主代码
- `FundBaseInfo`：基金公司、经理、类型、净值日期、单位净值等基础信息
- `ZTJJInfo`：主题/板块信息

### 自选基金详情

```http
POST https://api.fund.eastmoney.com/favor/GetFundsInfo?
Content-Type: application/x-www-form-urlencoded

fcodes=007300
```

返回 `Data.KFS/HBX/LCX/CN/HK/GD` 分类列表。只查一个代码时接口可能夹带推荐基金，调用方应按 `FCODE` 过滤目标基金。

常见字段：

- `FCODE`：基金代码
- `SHORTNAME`：简称
- `DWJZ`：单位净值，货币类可能表示万份收益
- `LJJZ`：累计净值，货币类可能表示 7 日年化
- `RZDE`：日增长值
- `RZDF`：日增长率
- `FSRQ`：净值日期
- `gsz`：盘中估算净值
- `gszzl`：盘中估算涨跌幅
- `FUNDTYPE` / `RSFUNDTYPE`：类型编码
- `FTYPE`：类型中文
- `SGZT`：申购状态
- `SYL_LN`：成立以来收益率

## 推荐相关接口

### 感兴趣/推荐基金

```http
POST https://api.fund.eastmoney.com/favor/GetRecommendNew?
Content-Type: application/x-www-form-urlencoded

fcodes=007300
```

返回推荐基金列表。实测字段：

- `FCODE`：推荐基金代码
- `SHORTNAME`：推荐基金简称
- `SYL_3Y`：近 3 年收益率字段，页面模板用于“感兴趣”
- `SYL_1N`：近 1 年收益率字段
- `ISAddFavor`：是否已加入自选

### 基金收益排行

```http
POST https://api.fund.eastmoney.com/favor/ranknew
Content-Type: application/x-www-form-urlencoded

fcodes=007300&gid=
```

返回指定基金集合的收益统计排行。字段：

- `SYL_Z`：近一周
- `SYL_Y`：近一月
- `SYL_3Y`：近三月
- `SYL_6Y`：近六月
- `SYL_JN`：今年来
- `SYL_1N` / `SYL_2N` / `SYL_3N` / `SYL_5N`：近 1/2/3/5 年
- `SYL_LN`：成立以来
- `FEATURE`：基金特征标签编码

### 基金吧相关帖子

```http
POST https://api.fund.eastmoney.com/favor/jjbNew?
Content-Type: application/x-www-form-urlencoded

fcodes=007300
```

返回关联基金吧帖子：

- `post_title`：帖子标题
- `post_last_time`：最后时间
- `post_id`：帖子 ID
- `FCODE` / `SHORTNAME`：基金代码和名称

### 推荐/热门图标信息

```http
POST https://api.fund.eastmoney.com/favor/GetHTPNew?
Content-Type: application/x-www-form-urlencoded

fcodes=007300
```

返回：

- `FCODE`
- `ISHOT`
- `CCZB`
- `Tips`

## 市场行情相关接口

### 指数/ETF/场内行情快照

```http
GET https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f1,f2,f3,f4,f7,f8,f12,f13,f14,f15,f16,f17,f18&ut=267f9ad526dbe6b0262ab19316f5a25b&invt=2&secids=1.000001,0.399001
```

`secids` 格式：

- `1.xxxxxx`：上交所
- `0.xxxxxx`：深交所
- `100.HSI`：恒生指数
- `100.SPX`：标普 500
- `100.NDX100`：纳指 100

页面默认行情配置接口：

```http
GET https://api.fund.eastmoney.com/favor/GetModuleConfig?type=1
```

实测默认返回：

```text
1.000001, 1.000300, 0.399001, 0.399006, 0.399005, 100.HSI, 100.SPX, 100.NDX100
```

行情字段：

- `f1`：市场/状态字段
- `f2`：最新价/点位
- `f3`：涨跌幅
- `f4`：涨跌额
- `f7`：振幅
- `f8`：换手率/相关比例字段
- `f12`：代码
- `f13`：市场编号
- `f14`：名称
- `f15`：最高
- `f16`：最低
- `f17`：今开
- `f18`：昨收

### 开放式基金盘中估值

```http
GET https://fundgz.1234567.com.cn/js/007300.js
```

返回 JSONP：

```js
jsonpgz({
  "fundcode": "007300",
  "name": "国联安中证半导体ETF联接A",
  "jzrq": "2026-05-28",
  "dwjz": "4.4057",
  "gsz": "4.1550",
  "gszzl": "-5.69",
  "gztime": "2026-05-29 15:00"
});
```

字段：

- `jzrq`：上一个净值日期
- `dwjz`：上一个单位净值
- `gsz`：估算净值
- `gszzl`：估算涨跌幅
- `gztime`：估值时间

### 基金净值/收益走势图

```http
GET https://api.fund.eastmoney.com/FAvor/FundChart?fcode=007300&type=kfs
```

`type` 常见值：

- `kfs`：开放式基金
- `hbx`：货币基金
- `lcx`：理财
- `hk`：海外基金

返回：

- `LeftChart.Datas`：左图数据，通常是单位净值走势
- `RightChart.Datas`：右图数据，通常是累计收益走势
- `FundInfo`：当前净值、涨幅、评分等
- `ListTopic`：基金相关主题/板块

### 估值 SSE / WebSocket

页面常量里还有：

```text
https://api.fund.eastmoney.com/ssE/JJGZ
wss://push.tiantianfunds.com/hqsocket/websocket
```

这些用于页面实时推送，和普通 HTTP 查询相比更依赖页面运行环境、cookie 或连接协议。若只做查询型接口，优先使用 `fundgz.1234567.com.cn/js/{fundcode}.js` 和 `GetFundsInfo` 里的 `gsz/gszzl`。

## 登录态/自选账户接口

这些接口存在，但不是公共基金数据接口：

- `https://fundfavorapi.eastmoney.com/favor/fcode/get2`：未登录返回 `您没有权限`
- `https://api.fund.eastmoney.com/favor/GetLocalFundAsset?`：未登录返回 `ErrCode=-3`
- `https://api.fund.eastmoney.com/favor/GetImportFundAsset?`：交易/通行证登录相关
- `favor/fcode/add`、`favor/fcode/del`、`setTopNew`、`updateOrder`、`group/get`：自选增删改、分组、排序，需要登录 token

## 已失效或需二次确认

页面脚本仍保留：

```http
https://news.1234567.com.cn/api/AppService/GetFundRelatedNews?...&FundCodes=007300...
```

当前实测返回东方财富 404 页面，暂不建议作为可用数据源。


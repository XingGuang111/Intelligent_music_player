# 接口调用示例

以下示例均假设服务运行在 `http://localhost:3000`。

## 免登录接口

### 搜索

```
# PowerShell
Invoke-RestMethod "http://localhost:3000/search?keywords=周杰伦&type=1&limit=5"

# curl
curl "http://localhost:3000/search?keywords=%E5%91%A8%E6%9D%B0%E4%BC%A6&type=1&limit=5"
```

`type` 取值：`1` 单曲、`10` 专辑、`100` 歌手、`1000` 歌单、`1002` 用户、`1009` 电台。

### 歌曲详情

```
curl "http://localhost:3000/song/detail?ids=347230"
curl "http://localhost:3000/song/detail?ids=347230,347231"   # 多首用逗号分隔
```

### 歌词

```
curl "http://localhost:3000/lyric?id=347230"
```

返回 `lrc.lyric`（原文）和 `tlyric.lyric`（翻译，可能为空）。

### 歌单详情

```
curl "http://localhost:3000/playlist/detail?id=24381616"
```

## 需要登录的接口

先在 `.env` 配好 `NCM_COOKIE`，或按下面方式显式传入。

### 播放链接

```
curl "http://localhost:3000/song/url?id=347230&level=exhigh"
```

`level` 取值：`standard` 标准、`higher` 较高、`exhigh` 极高、`lossless` 无损、`hires` Hi-Res。

返回示例：

```json
{
  "code": 200,
  "data": [{
    "id": 347230,
    "url": "http://m802.music.126.net/....mp3",
    "br": 128008,
    "size": 720948,
    "type": "mp3",
    "time": 45035
  }]
}
```

> **实测结论**：`/song/url` 可用；`/song/url/v1` 在 v4.40.1 上返回 404，不要用它。
>
> **未登录时**返回的是试听片段（约 30~45 秒、128kbps），不是完整歌曲。要听完整版必须先配置 Cookie。

### 个人歌单

```
curl "http://localhost:3000/user/playlist?uid=YOUR_UID"
```

### 听歌记录

```
curl "http://localhost:3000/user/record?uid=YOUR_UID&type=1"
```

`type=1` 为最近一周，`type=0` 为全部。

## 显式传 Cookie

不依赖 `.env`，由调用方自己带凭证（适合多账号共用同一服务）：

```
# 请求头方式
curl -H "Cookie: MUSIC_U=xxx; __csrf=xxx" "http://localhost:3000/user/playlist?uid=123"

# URL 参数方式（需 URL 编码分号）
curl "http://localhost:3000/user/playlist?uid=123&cookie=MUSIC_U%3Dxxx%3B%20__csrf%3Dxxx"
```

显式传入的 Cookie 优先级高于 `.env` 里的 `NCM_COOKIE`。

## 从 Python 调用

```python
import requests

BASE = "http://localhost:3000"

def search(keyword, type_=1, limit=5):
    r = requests.get(f"{BASE}/search", params={
        "keywords": keyword, "type": type_, "limit": limit
    })
    return r.json()

def lyric(song_id):
    return requests.get(f"{BASE}/lyric", params={"id": song_id}).json()

if __name__ == "__main__":
    result = search("海阔天空")
    for song in result["result"]["songs"]:
        print(song["id"], song["name"], "-", song["artists"][0]["name"])
```

## 健康检查

```
curl "http://localhost:3000/health"
```

返回：

```json
{
  "status": "ok",
  "cookieConfigured": false,
  "internalPort": 57813,
  "watchingEnv": true,
  "uptimeSeconds": 123,
  "node": "v24.19.0"
}
```

`watchingEnv: true` 表示 `.env` 热加载监听正常（改 Cookie 免重启）；`internalPort` 是内层 API 的随机回环端口，仅排查时用。

`cookieConfigured: false` 表示 `.env` 里没配 Cookie，登录态相关接口会失败。

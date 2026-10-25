import needle from 'needle'

// 精简自上游项目的 request.js，只保留歌单解析需要的 httpFetch。
// 与原版行为一致：返回 { promise, cancelHttp }，promise 解析为
// { statusCode, body, headers }，body 会自动尝试 JSON.parse（失败则返回字符串），
// 并且默认不跟随重定向（follow_max=0），方便上层自己读 headers.location。

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/69.0.3497.100 Safari/537.36',
}

const request = (url, options, callback) => {
  let data
  if (options.body) {
    data = options.body
  } else if (options.form) {
    data = options.form
    options.json = false
  } else if (options.formData) {
    data = options.formData
    options.json = false
  }
  options.response_timeout = options.timeout

  return needle.request(options.method || 'get', url, data, options, (err, resp, body) => {
    if (!err) {
      body = resp.body = resp.raw.toString()
      try {
        resp.body = JSON.parse(resp.body)
      } catch (_) {}
      body = resp.body
    }
    callback(err, resp, body)
  }).request
}

const fetchData = async(url, method, {
  headers = {},
  format = 'json',
  timeout = 15000,
  ...options
}, callback) => {
  headers = Object.assign({}, headers)
  return request(url, {
    ...options,
    method,
    headers: Object.assign({}, defaultHeaders, headers),
    timeout,
    json: format === 'json',
  }, (err, resp, body) => {
    if (err) return callback(err, null)
    callback(null, resp, body)
  })
}

const buildHttpPromise = (url, options) => {
  const obj = {
    isCancelled: false,
    cancelHttp: () => {
      obj.isCancelled = true
      if (obj.requestObj) {
        obj.requestObj.abort?.()
        obj.requestObj = null
      }
    },
  }
  obj.promise = new Promise((resolve, reject) => {
    fetchData(url, options.method, options, (err, resp, body) => {
      obj.requestObj = null
      if (err) return reject(err)
      resolve(resp)
    }).then(ro => {
      obj.requestObj = ro
      if (obj.isCancelled) obj.cancelHttp()
    })
  })
  return obj
}

export const httpFetch = (url, options = { method: 'get' }) => buildHttpPromise(url, options)

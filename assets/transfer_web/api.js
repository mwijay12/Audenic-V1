// 网页要打的六条路由的薄封装（§5.1）。这一层只管「怎么说」——成帧、错误归一、标识符生成；
// 「什么时候说」归 queue.js。
//
// 两条贯穿本文件的约定：
//
// 1. **线上的字段是 snake_case，出了这一层就全是 camelCase**。映射只此一份，改协议时不会有
//    另一处还在读旧名字。
// 2. **失败一律抛 LpError**，带 HTTP 状态码与 §5.6 的错误码；连不上算 status 0、code 'network'。
//    调用方只认这一种形状，不必区分 fetch 的 TypeError 与服务端的 4xx。
(function () {
  var LP = window.LP;

  /** §5.1：取配置不得阻塞用户，超时就跳过本地过滤直接发 batch/start */
  var CONFIG_TIMEOUT_MS = 2000;

  /**
   * §5.1 的心跳超时。**必须有**：没有它的话一条卡住的 ping 会一直挂着，而心跳循环是串行的，
   * 后面的都发不出去，45 s 之后手机端就把本端判离线、占用让给别人了
   */
  var PING_TIMEOUT_MS = 3000;

  /** 标识符格式 `[A-Za-z0-9_-]{1,64}`（§5.6），16 字节十六进制 = 32 字符 */
  var ID_BYTES = 16;

  var SENDER_KEY = 'lp_sender_id';

  /** 同一浏览器各页互相喊话的频道，同源共享（见 [claimSender]） */
  var CHANNEL_NAME = 'lp_transfer_sender';

  // 三段等待。postMessage 是本机的事，余量都是留给后台标签页的
  var PROBE_WAIT_MS = 250;
  var SETTLE_WAIT_MS = 100;
  var REPROBE_MS = 2000;

  // ---------------------------------------------------------------------------
  // 错误
  // ---------------------------------------------------------------------------

  function LpError(status, code) {
    this.name = 'LpError';
    this.status = status;
    this.code = code;
    this.message = status + ' ' + code;
  }

  LpError.prototype = Object.create(Error.prototype);
  LpError.prototype.constructor = LpError;

  /** 连不上、被 RST、跨站被拦——网页端看到的都是「没有响应」，归一成同一种 */
  function networkError() {
    return new LpError(0, 'network');
  }

  function rethrow(e) {
    throw (e instanceof LpError) ? e : networkError();
  }

  // ---------------------------------------------------------------------------
  // 标识符
  // ---------------------------------------------------------------------------

  /**
   * 32 个十六进制字符。
   *
   * **不能用 `crypto.randomUUID()`**——它只在 secure context 可用，而本页跑在
   * `http://<IP>:8080` 上，那个方法是 `undefined`。`crypto.getRandomValues` 没有这条限制。
   * 最后那档 `Math.random` 只为古董浏览器兜底：这三个 id 只要求批次内不撞，不是密码学用途。
   */
  function randomId() {
    var filled = null;
    if (window.crypto && window.crypto.getRandomValues) {
      filled = new Uint8Array(ID_BYTES);
      window.crypto.getRandomValues(filled);
    }
    var out = '';
    for (var i = 0; i < ID_BYTES; i++) {
      var b = filled ? filled[i] : Math.floor(Math.random() * 256);
      out += (b + 0x100).toString(16).slice(1);
    }
    return out;
  }

  /**
   * 同一浏览器各页互相喊话的频道。**建不出来就是 null**——没有这个 API、或构造抛了，两种情况
   * 一个判据：持久化（[senderStore]）与本地互斥（[claimSender]）必须同进同退，各自判会在
   * 「构造抛了」那一档留下存得住却挡不住的缝
   */
  var channel = null;
  try {
    if (window.BroadcastChannel) channel = new window.BroadcastChannel(CHANNEL_NAME);
  } catch (e) {
    channel = null;
  }

  /** [senderId] 存哪儿。`log.js` 的启动探针要用同一份判据，所以从这里出（§7.4） */
  function senderStore() {
    return channel ? window.localStorage : window.sessionStorage;
  }

  /**
   * 这一次页面加载的实例 id（§5.1）。**只能在内存里**——存进任何 storage 都会被下一次加载读到，
   * 手机端就再也分不出「关了重开」（`TransferCommands.ping`）。
   */
  var pageId = randomId();

  /**
   * 这个浏览器的身份（§5.1）。**按浏览器存**，关了重开才认得出还是同一个发送端。
   *
   * **持久化与本地互斥是一个决定的两半，不能只做一半**：存得住，同浏览器两页的 `sender_id` 就
   * 一样、手机端分不出来，得靠 [claimSender] 在本地挡；挡不住（`BroadcastChannel` 不在）就退
   * 回 `sessionStorage` 的按页身份，交还给手机端 409。两条分支守同一条不变量：**一个
   * `sender_id` 同时只有一个活页面**。
   *
   * 两种 storage 都被隐私模式禁掉时退回内存变量，刷新即换身份、要等旧占用 45 s 超时。
   */
  var memorySenderId = null;

  function senderId() {
    if (memorySenderId) return memorySenderId;
    try {
      var store = senderStore();
      var stored = store.getItem(SENDER_KEY);
      if (!stored) {
        stored = randomId();
        store.setItem(SENDER_KEY, stored);
      }
      memorySenderId = stored;
    } catch (e) {
      memorySenderId = randomId();
    }
    return memorySenderId;
  }

  /**
   * 独占本浏览器的发送端身份，**拿到了才准发心跳**：同浏览器两页的 `sender_id` 是同一个，谁先
   * ping 手机端都照收，两边就都成了「已连接」。
   *
   * **不能用 Web Locks**：`navigator.locks` 是 `[SecureContext]` 的，而本页跑在
   * `http://<IP>:8080` 上——与上面 `crypto.randomUUID()` 同一个坑，且 `localhost` 算
   * potentially trustworthy，本地预览一切正常、一上真机整条降级还看不出来。
   *
   * 于是两段：**探测**（广播 `probe`，开工中的那页回 `held`）与**宣布**（没人应就广播 `claim`，
   * 见 [settle]）。**没有 TTL、不看时钟**——关了、崩了、被杀的页答不上话，这就是判据。占用着的
   * 那页每 [REPROBE_MS] 重探一次，持有页一消失就接上。
   *
   * 不覆盖持有页进 bfcache 那一档（Chrome / Firefox 下挂着监听器的频道本就进不了）：真回来了，它的
   * `page_id` 已被后起那页的重开淘汰，心跳撞手机端 409 进占用屏（`TransferCommands.ping`），刷新即恢复。
   *
   * @param onGranted 拿到身份可以开工，**只会被调一次**
   * @param onBusy 本浏览器另有一页开着；那页关掉之后 [onGranted] 会被调一次
   */
  function claimSender(onGranted, onBusy) {
    /** 开工了没有。开了就要负责回答别人的探测 */
    var granted = false;
    var claiming = false;
    /** 有人已经在开工、先一步宣布了、或同期宣布但 id 比我小 */
    var answered = false;
    var told = false;

    function grant() {
      if (granted) return;
      granted = true;
      onGranted();
    }

    // 频道没有就放行：不放行就是一拍心跳都不发，页面绿着图标、加号点不动、一个字不解释
    // （`app.js` [beat] 那段说的静默死亡）。多连一页的代价远小于它——而且这时身份是按页存的
    // （[senderStore]），多的那页会被手机端 409 挡回
    if (!channel) {
      grant();
      return;
    }

    function post(t) {
      channel.postMessage({ t: t, from: pageId });
    }

    channel.onmessage = function (event) {
      var msg = event.data;
      if (!msg || msg.from === pageId) return;
      if (msg.t === 'probe') {
        if (granted) post('held');
      } else if (msg.t === 'held') {
        // 有页在开工。**任何阶段收到都算数**，包括宣布段里迟到的那一条
        answered = true;
      } else if (msg.t === 'claim') {
        // 还在探测段就说明对方快了一步，直接让；同期宣布的按 id 定序，只让给比我小的
        if (!claiming || msg.from < pageId) answered = true;
      }
    };

    function busy() {
      if (!told) {
        told = true;
        onBusy();
      }
      setTimeout(probe, REPROBE_MS);
    }

    function probe() {
      answered = false;
      post('probe');
      setTimeout(function () {
        if (answered) busy();
        else settle();
      }, PROBE_WAIT_MS);
    }

    /**
     * 宣布段。**不能省**：探测段的互看是不对称的——先起的那页广播 `probe` 时，后起的那页连频道
     * 都还没建出来；而先起的那页此刻也还没开工、答不上话。于是两页都以为场上没人。到这一段两边
     * 的频道都在了，`claim` 必定互看得见，按 `page_id` 定序、大的让小的。
     */
    function settle() {
      claiming = true;
      post('claim');
      setTimeout(function () {
        claiming = false;
        if (answered) busy();
        else grant();
      }, SETTLE_WAIT_MS);
    }

    probe();
  }

  // ---------------------------------------------------------------------------
  // 成帧
  // ---------------------------------------------------------------------------

  function readJson(response) {
    return response.text().then(function (text) {
      var body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch (e) {
        body = null;
      }
      if (!response.ok) throw new LpError(response.status, (body && body.error) || 'unknown');
      return body;
    });
  }

  /**
   * 带超时的取。`build(signal)` 拿中止信号自己拼链，settle 时清定时器。
   *
   * **定时器盖的是整条链，不是「header 到达」**：`ping` 那条链读完头还要再读一次 body
   * （`readJson` 里的 `response.text()`），做成 header 一到就清的 `fetchWithTimeout` 的话，
   * 心跳的超时窗口会悄悄缩成只算头——而它正是用来兜住「连接还在、对面不回话」的
   * （见 [PING_TIMEOUT_MS]）。
   */
  function withTimeout(ms, build) {
    var abort = new AbortController();
    var timer = setTimeout(function () { abort.abort(); }, ms);
    return build(abort.signal).then(
      function (value) {
        clearTimeout(timer);
        return value;
      },
      function (error) {
        clearTimeout(timer);
        throw error;
      }
    );
  }

  /** JSON 路由必须带 `Content-Type: application/json`，否则 415（§4.1 防线①） */
  function postJson(path, body) {
    return fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(readJson, rethrow);
  }

  /**
   * 报给手机端的前后台档。**由 `app.js` 置位，不在这里读 `document.hidden`**：只有去系统文件
   * 选择器那一次隐藏才配换宽限，用户切走干别的仍按 45 s 判（见 `app.js` 的 [onVisibility]）
   */
  var away = false;

  function setAway(flag) {
    away = flag;
  }

  // ---------------------------------------------------------------------------
  // 五条路由
  // ---------------------------------------------------------------------------

  /**
   * **每一拍都带上当前前后台档，不只是切换那一刻**：页面隐藏之后浏览器还会放几拍心跳出去
   * （限流之下间隔不定），其中任何一拍漏报都会把手机端的宽限打回 45 s——而那一拍往往就是
   * 冻结前的最后一拍。`away` 是状态不是事件。
   */
  function pingUrl() {
    return '/api/ping?sender_id=' + encodeURIComponent(senderId()) +
      '&page_id=' + encodeURIComponent(pageId) +
      (away ? '&away=1' : '');
  }

  /**
   * `GET /api/ping` —— 心跳兼注册兼占用。回包没有消费者，只当信号用。
   *
   * 两档会抛 `LpError`：409 `occupied` 与 410 `disconnected`（见 `queue.isNotAdmitted`）
   */
  function ping() {
    return withTimeout(PING_TIMEOUT_MS, function (signal) {
      return fetch(pingUrl(), { signal: signal }).then(readJson, rethrow);
    });
  }

  /**
   * 切后台那一刻**补发**的一拍，不等排着的定时器——隐藏之后可能一拍都轮不上就冻住了。
   *
   * **档位走入参、顺带置位 [away]**：靠调用方先 [setAway] 的话，漏掉或颠倒都不报错，只是那一拍
   * 悄悄不带 `away=1` 发出去——按 [pingUrl]，漏一拍就把宽限打回 45 s
   *
   * **`keepalive` 而不是普通 fetch**：页面接着就要被限流、隐藏久了整个冻结，交给浏览器发才送得
   * 出去。不设超时也不看回包——结论由回前台那一拍给
   */
  function pingAway(flag) {
    away = flag;
    fetch(pingUrl(), { keepalive: true }).catch(function () {});
  }

  /**
   * `GET /api/config` —— 首次选文件那一刻取一次，整页缓存（`queue.js` 的 `configOnce`，理由在那儿）。
   *
   * **取不到回 null，不抛**：调用方据此跳过本地预过滤直接发 `batch/start`，手机端预检才是权威
   * 判定。配置接口抖一下不该让用户选不了文件，2 s 超时同理——宁可不过滤也不能干等。
   */
  function config() {
    return withTimeout(CONFIG_TIMEOUT_MS, function (signal) {
      return fetch('/api/config', { signal: signal })
        .then(function (response) { return response.ok ? response.json() : null; })
        .catch(function () { return null; });
    }).then(function (body) {
      if (!body) return null;
      // 黑名单两张表缺一不可地兜一层：手机端保证发空数组，但这里是唯一消费点，
      // 让它对着一个不合规的响应也别在 undefined 上跑 indexOf
      var blacklist = body.name_blacklist || {};
      return {
        maxFileSize: body.max_file_size,
        maxBatchItems: body.max_batch_items,
        kinds: body.kinds,
        nameContains: blacklist.contains || [],
        nameEquals: blacklist.equals || []
      };
    });
  }

  /**
   * `POST /api/batch/start` —— 预检。只判收不收，回包不带名字信息（§5.5 D19：改名在
   * 手机端落盘那一刻才算，网页列表上显示的始终是用户自己选的原名）。
   *
   * **带 [pageId]**：`sender_id` 按浏览器存，同浏览器两页拿到的是同一个，手机端光比它分不出
   * 「这一批是被淘汰的旧页面开的」。带上实例号它才能按世代挡（`TransferSession.startBatch`）。
   */
  function batchStart(batchId, source, items) {
    return postJson('/api/batch/start', {
      batch_id: batchId,
      sender_id: senderId(),
      page_id: pageId,
      source: source,
      items: items.map(function (item) {
        return {
          item_id: item.itemId,
          name: item.name,
          size: item.size
        };
      })
    }).then(function (body) {
      var rejected = {};
      (body.rejected || []).forEach(function (entry) { rejected[entry.item_id] = entry.reason; });
      return {
        accepted: body.accepted || [],
        rejected: rejected
      };
    });
  }

  /**
   * `PUT /api/upload` —— 唯一的流式路由。
   *
   * **必须走 XHR 不能走 fetch**：只有 `xhr.upload.onprogress` 报得出上传进度，fetch 没有
   * 对应事件。两个回调分工：
   *
   * - `onProgress(sent)` —— 已发字节，画单条进度
   * - `onBodySent()` —— body 发完，**此时就能发下一条**（§5.1 流水深度 3）。响应只等手机端
   *   落盘收尾、不等入库（§6.4），但等它才发下一条的话小文件批次仍会慢一拍
   *
   * 落盘失败（`{saved:false, cause}`）是 200，**按正常结果 resolve 不抛**：字节已经传过去了，
   * 这是业务结果不是请求错误。抛出来的只有 409 / 429 / 507 与断连。
   *
   * `onOpen(abort)` 交出中止句柄。用户按 Stop 时要把在飞的这条掐掉（协议 §7：停下来时在飞
   * 条目 abort 并关连接），否则它会一直传到完，Stop 就名不副实。中止走 `xhr.onabort`、抛
   * `LpError(0, 'aborted')`，**与断连的 `network` 分开**：`abort()` 只有拿着句柄的调用方会调，
   * 所以这一档必然是自己掐的，`queue.js` 据此把它退回排队而不是落失败。
   */
  function upload(batchId, item, onProgress, onBodySent, onOpen) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var bodyDone = false;

      function finish(fn, value) {
        if (settled) return;
        settled = true;
        fn(value);
      }

      // 早拒（409 / 429 / 507）时手机端读完头就回响应并关连接，upload 事件会以 error 收场——
      // 那不是「可以发下一条」，得挡住
      function bodySent(ok) {
        if (bodyDone || !ok) return;
        bodyDone = true;
        onBodySent();
      }

      var xhr = new XMLHttpRequest();
      // `page_id` 同 [batchStart]：`sender_id` 分不出被淘汰的旧页面，实例号才分得出
      xhr.open('PUT', '/api/upload?batch_id=' + encodeURIComponent(batchId) +
        '&item_id=' + encodeURIComponent(item.itemId) +
        '&page_id=' + encodeURIComponent(pageId));
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      // **不发源文件的 mtime**：手机端落盘后不再回写它。写了的话一首 2019 年的歌传过去 mtime
      // 还是 2019，而 LP 的歌曲列表默认按 mtime 倒序排（`Consts.DEFAULT_AUDIO_SORT_BY`），
      // 刚传的东西会沉到列表最底下。落盘时间即 mtime，与云盘下载一致

      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) onProgress(e.loaded);
      };
      xhr.upload.onload = function () { bodySent(true); };
      xhr.upload.onerror = function () { bodySent(false); };
      xhr.upload.onabort = function () { bodySent(false); };

      xhr.onload = function () {
        var body = null;
        try {
          body = JSON.parse(xhr.responseText);
        } catch (e) {
          body = null;
        }
        if (xhr.status !== 200 || !body) {
          finish(reject, new LpError(xhr.status, (body && body.error) || 'unknown'));
          return;
        }
        // 回包只有 `saved` 与失败时的 `cause`，**成功没有分档**（§6.4 第 3 条：回包不等入库，
        // 不带 `visibility`）。「在不在媒体库里」由手机端自己表达（第 4 条）——隔着一台设备
        // 说不清也没法处置，往上传一个没人读的字段只会让人以为它有用
        finish(resolve, { saved: !!body.saved, cause: body.cause });
      };
      xhr.onerror = function () { finish(reject, networkError()); };
      xhr.onabort = function () { finish(reject, new LpError(0, 'aborted')); };

      xhr.send(item.file);
      if (onOpen) onOpen(function () { xhr.abort(); });
    });
  }

  /**
   * `POST /api/batch/cancel` —— 放弃这一批剩下的（§5.1）。
   *
   * **只在用户明确结束这一批时打**（中断态的 Done）：不打的话手机端那边剩余条目一直停在
   * `queued`，接收端界面会挂着 N 条永远不来的文件。
   *
   * **暂停不能打**：它把 `queued` 转成 `canceled` 终态，打完 Resume 就接不回来了——
   * `beginUpload` 只认 `queued` 与 `not_sent`。
   *
   * 两种调用方式：
   *
   * - 不传 `itemIds` = 整批剩余，用户明确结束这一批时打（中断态的 Done）
   * - 传 `itemIds` = 只放弃这几条，`queue.js` 在某条重试耗尽、本地标失败时打 —— 不打的话手机端
   *   那条一直停在 `queued`，而我们这边已经不再重发了，接收端界面会挂着一条永远不来的文件
   *
   * 失败静默：这是给对面清场用的，没必要为它拦一下。手机端只对 `queued` 的条目生效，
   * 已经在传或已结算的不受影响
   */
  function cancelBatch(batchId, itemIds) {
    var body = { batch_id: batchId };
    if (itemIds && itemIds.length) body.item_ids = itemIds;
    postJson('/api/batch/cancel', body).catch(function () {});
  }

  /** 最近一拍打通的心跳往返毫秒数，随每条埋点带上去（`env.rtt_ms`）。还没打通过时是 null */
  var lastRttMs = null;

  /** rtt 由 `app.js` 的心跳测（`log.ping` 用的也是那一个数），每打通一拍递过来 */
  function noteRtt(ms) {
    lastRttMs = ms;
  }

  /**
   * 没送出去、等链路回来再发的埋点（产品口径：断连时漏报可以接受，但能补的补上）。只存内存：
   * 刷新或关页就丢。设上限是因为断着网的时候没有别的东西会来清它
   */
  var pendingEvents = [];
  var MAX_PENDING_EVENTS = 50;

  /**
   * 每条埋点都带的浏览器侧环境，手机端再拼上从 User-Agent 推出的系统、浏览器、应用内浏览器，
   * 一起报成 `arg1`。拿不到的项不放
   */
  function envOf(speedKbps) {
    var env = {};
    if (window.screen) env.resolution = window.screen.width + 'x' + window.screen.height;
    if (navigator.language) env.lang = navigator.language;
    if (lastRttMs !== null) env.rtt_ms = lastRttMs;
    if (speedKbps != null) env.speed_kbps = speedKbps;
    return env;
  }

  function sendEvent(body) {
    postJson('/api/event', body).catch(function (error) {
      // 只留「没送到」的：没有响应，或手机端工作线程一时占满（503）。手机端明确拒了的（400 等）
      // 再发一遍还是一样
      var undelivered = error.status === 0 || error.code === 'server_busy';
      if (undelivered && pendingEvents.length < MAX_PENDING_EVENTS) pendingEvents.push(body);
    });
  }

  /**
   * `POST /api/batch/stop` —— 告诉手机端「这一下是用户按的 Stop」（§7 ③），它只记一个标记、
   * 不改任何条目状态。没有它的话按 Stop 与链路断了在那一侧同形，只能靠有没有心跳去猜。
   *
   * 失败静默，同 [cancelBatch]：发不出去就退化回手机端等 45 s 的老路
   */
  function stopBatch(batchId) {
    postJson('/api/batch/stop', { batch_id: batchId }).catch(function () {});
  }

  /**
   * `POST /api/event` —— 埋点转发，由手机端报成 `FileTransfer` 事件（§5.1）。失败不影响传输；
   * 没送到的先攒着，由 `app.js` 在心跳打通时 [flushEvents]。action 与 `props` 的键就是埋点名，
   * 手机端按白名单收，拼错整条回 400
   *
   * @param speedKbps 上传速度，只有停止、完成两条带，并进 `env`
   */
  function event(action, batchId, props, speedKbps) {
    // 环境在这一刻取：补发的那条报的仍是当时的心跳延迟，不是链路回来之后的
    var body = { action: action, env: envOf(speedKbps) };
    if (batchId) body.batch_id = batchId;
    if (props) body.props = props;
    sendEvent(body);
  }

  function flushEvents() {
    if (!pendingEvents.length) return;
    var waiting = pendingEvents;
    pendingEvents = [];
    waiting.forEach(sendEvent);
  }

  // 只导出真有人调的。`LpError` 只是本文件里的错误形状，调用方读的是 `error.code`
  LP.api = {
    randomId: randomId,
    // `log.js` 回传时要带 `sender_id`（§5.1）。**必须是这一份**：自己再生成一个的话，
    // 身份 storage 被禁那种情况下两边会分叉成两个 id，日志就归不到正在排查的那个会话上
    senderId: senderId,
    // `log.js` 的 `page.boot` 探针要判身份 storage 可用性，判据只有这一份（§7.4）
    senderStore: senderStore,
    claimSender: claimSender,
    ping: ping,
    setAway: setAway,
    pingAway: pingAway,
    config: config,
    batchStart: batchStart,
    upload: upload,
    cancelBatch: cancelBatch,
    stopBatch: stopBatch,
    event: event,
    noteRtt: noteRtt,
    flushEvents: flushEvents
  };
})();

// 网页侧调试日志的产生与回传（§5.2-§5.6、§7.4）。本文件只做三件事：把页面里发生的事攒成
// 结构化的行、按预算批量 POST 给手机端、在页面消失前用 beacon 兜底。
//
// 三条贯穿全文件的约定：
//
// 1. **调试设施不许影响被调试的对象**（§8 铁律）。每个对外入口都套 [guard]，任何一处失败都
//    只在本文件里消化，不抛给调用方；对外的 `LP.log` 先挂一份空实现，真实现装好了才逐个覆盖
//    ——即便本文件中途抛异常，`queue.js` / `app.js` 里那些调用点也只是调到 no-op。
// 2. **`kv` 发结构化对象而不是拼好的字符串**（§5.1）：定宽、引号、转义这些格式化规则只留
//    Kotlin 一份，网页不复述。`event` 与 `kv` 的 key 都按手机端那道 `[a-z0-9._]{1,18}` 起名。
// 3. **本文件是第一个加载的 `<script src>`**（§5.5），跑的时候 `LP.api` / `LP.queue` 都还不
//    存在。所以对它们的引用一律**推迟到函数体里**取，顶部不能缓存。
(function () {
  // 先把空实现挂上去：调用点遍布 queue.js / app.js，接口必须无条件存在。下面任何一步炸了，
  // 页面最坏只是没有调试日志，不会在别人的热路径上抛 TypeError
  var NAMES = [
    'ping', 'link', 'visibility', 'pick', 'batchSend',
    'uploadSend', 'uploadDone', 'uploadFail',
    'reopen', 'reopenDone', 'pause', 'suspect'
  ];

  var out = {};
  for (var n = 0; n < NAMES.length; n++) out[NAMES[n]] = function () {};

  try {
    window.LP.log = out;
  } catch (e) {
    return;
  }

  try {
    install(out);
  } catch (e) {
    // 装不上就维持空实现
  }

  function install(exports) {
    var LP = window.LP;

    /** §5.1 的回传路由。手机端 `LiteHttpServer.DEBUG_LOG_PATH` 按同一个串做 §7.5 的自噪声过滤 */
    var PATH = '/api/debug/log';

    /** §5.1 硬约束：一个请求最多 100 条。beacon 那条 `page.hide` 也占一格（见 [hide]） */
    var MAX_LINES = 100;

    /** §5.3 常规批次的字节预算。**不按条数**——大批次的拒因行短、`upload.send` 带中文名长，两者脱钩 */
    var BYTE_BUDGET = 32 * 1024;

    /** 攒够 [BYTE_BUDGET] 之前最多等这么久 */
    var MAX_WAIT_MS = 2000;

    /** 给设施本身的请求速率封顶（§5.3）。失败重发也受它约束 */
    var MIN_GAP_MS = 250;

    /**
     * 连续失败时的退避上限。§5.3 只说「退回缓冲头部」，没说节奏；按 [MIN_GAP_MS] 死磕的话，
     * 「手机端不答复」这个**本来就是要排查的现象**会被本设施每 250 ms 一次的 POST 加重——
     * 与铁律相抵。翻倍退避到这个上限封顶
     */
    var MAX_BACKOFF_MS = 2000;

    /** §5.3 缓冲上限。溢出时保头保尾、丢中间段（见 [trim]） */
    var MAX_BUFFER = 500;

    /** 溢出淘汰时保住的开头条数。故障现场的前因在这里 */
    var HEAD_KEEP = 100;

    /** §5.3 坑 2：beacon 的字节预算。Chrome 对 beacon 另有 64 KB 配额，留足余量 */
    var BEACON_BUDGET = 48 * 1024;

    /** §5.4：偏移较上次变化超过这个值才记一行 `clock.recal`。半秒以下不改变时间线的阅读结论 */
    var RECAL_MS = 500;

    /** 上报值的长度上限。手机端还会再截 512，这里先截一道免得一个畸形值撑爆缓冲 */
    var VALUE_MAX = 512;

    // -------------------------------------------------------------------------
    // 状态
    // -------------------------------------------------------------------------

    /** §5.6：页面实例内自增。手机端据它做 `web.gap` 判定，键名必须就叫 `seq` */
    var seq = 0;

    /** 待发的行，元素形状 `{at, n, raw, keep}`。`raw.t` 是**原始**时钟，折算推迟到发送那一刻（§5.4） */
    var buffer = [];

    /** [buffer] 的字节估算之和，用来判 [BYTE_BUDGET]。每条入队时算一次 */
    var bufferBytes = 0;

    /** 已摘出缓冲、正在飞的那一批。`pagehide` 时要把它重新并进 beacon（§5.3 末段） */
    var flying = null;

    /** ping 回答过没有。答之前照常缓冲——首拍在 `DOMContentLoaded` 就发，启动段丢不了几行 */
    var known = false;

    /** ping 回包里的 `debug_log`（L10）。开与关双向生效 */
    var enabled = false;

    /** 撞过 404：清空缓冲、不再发，等下一拍 ping 说开了再恢复。**不是永久禁用**（§5.2） */
    var paused = false;

    var timer = 0;
    var lastSendAt = 0;
    var failures = 0;

    /** §5.4：`server_time + rtt / 2 - Date.now()`，保留 rtt 最小的那个样本 */
    var offset = 0;
    var bestRtt = Infinity;
    var calibrated = false;

    /** 缓存下来的 `sender_id`。`api.senderId()` 自己有内存兜底，这里只是免得每批都问一次 */
    var sender = null;

    // -------------------------------------------------------------------------
    // 工具
    // -------------------------------------------------------------------------

    /**
     * 对外入口的统一护栏（§8 铁律）。上报是挂在传输热路径上的旁支，**一次都不许抛回调用方**：
     * `queue.js` 里那些调用点后面跟着的是真正的业务收尾。
     *
     * 转发走 `arguments` 而不是写死几个形参：没有编译器盯着，写死之后新入口多带一个参数会
     * **静默丢参**——日志里少一栏，而任何一处都不会报错，只能靠读日志的人发现。
     */
    function guard(fn) {
      return function () {
        try {
          fn.apply(null, arguments);
        } catch (e) {
          // 吞掉。调试设施的故障不该有能力改变被调试的流程
        }
      };
    }

    /**
     * UTF-8 字节数估算。
     *
     * **不能拿 `JSON.stringify(x).length` 当字节数**：那是 UTF-16 码元数，一个汉字算 1，而
     * `JSON.stringify` 不转义非 ASCII、实际落到网线上是 3 字节。带中文文件名的批次会被低估到
     * 三分之一，32 KB 的预算真发出去就是 90 KB——直接撞穿 §5.1 的 64 KB 体积上限。
     * 代理对的两半各按 3 算（真实是 4），偏保守，安全方向对。
     */
    function byteLen(text) {
      var total = 0;
      for (var i = 0; i < text.length; i++) {
        var c = text.charCodeAt(i);
        total += c < 0x80 ? 1 : (c < 0x800 ? 2 : 3);
      }
      return total;
    }

    /**
     * kv 值归一：null / undefined 一律换成字面串 `'null'`，其余非数字非布尔的转字符串并截断。
     *
     * **不发 JSON 的 `null`**：那一头要看手机端怎么处置 `JSONObject.NULL`，而渲染出来要的就是
     * `config=null` 这几个字（§7.4）。发字符串两边都不会错。
     */
    function value(v) {
      if (v === null || v === undefined) return 'null';
      if (typeof v === 'number') return isFinite(v) ? v : 'null';
      if (typeof v === 'boolean') return v;
      var s = String(v);
      return s.length > VALUE_MAX ? s.slice(0, VALUE_MAX) : s;
    }

    function clean(kv) {
      var outKv = {};
      if (!kv) return outKv;
      var keys = Object.keys(kv);
      for (var i = 0; i < keys.length; i++) outKv[keys[i]] = value(kv[keys[i]]);
      return outKv;
    }

    // -------------------------------------------------------------------------
    // 缓冲
    // -------------------------------------------------------------------------

    /**
     * 记一行。**ping 明确说关了之后就不再攒**：开关关着时页面照样能跑出几千条上报，一路
     * `JSON.stringify` 加上 500 条常驻缓冲，对一个绝大多数时候是关着的设施而言是白交的税。
     */
    function write(batchId, itemId, event, kv) {
      if (known && !enabled) return;

      var raw = {
        seq: seq++,
        t: Date.now(),
        batch: batchId || null,
        item: itemId || null,
        event: event,
        kv: clean(kv)
      };
      var entry = {
        at: raw.t,
        // +16 是 [toLine] 补上去的 `cal` 字段与折算后可能变长的 `t` 的余量。**宁可高估**：
        // 低估会让一份 32 KB 预算的 body 真发出去超过 §5.1 的 64 KB 上限
        n: byteLen(JSON.stringify(raw)) + 16,
        raw: raw,
        keep: false
      };
      buffer.push(entry);
      bufferBytes += entry.n;
      trim();
      schedule();
    }

    /**
     * 溢出淘汰：**保头保尾、丢中间段**（§5.3）。
     *
     * 手机端卡住是缓冲堆积的唯一原因，而那时最该留的正是故障前后那一段——简单的「丢最旧」
     * 会把前因丢掉，还会让退回来的重试批次自噬。所以删除点固定在 [HEAD_KEEP]：开头那段留住，
     * 尾部因为是往后追加的天然留住，被吃掉的永远是中间。
     *
     * 刚从失败里退回来的那批（`keep`）豁免——它们是最有可能含着故障现场的行。
     */
    function trim() {
      while (buffer.length > MAX_BUFFER) {
        var i = HEAD_KEEP;
        while (i < buffer.length && buffer[i].keep) i++;
        // 全是豁免的：宁可多占一点内存也不丢它们，等发出去自然回落
        if (i >= buffer.length) return;
        bufferBytes -= buffer[i].n;
        buffer.splice(i, 1);
      }
    }

    /** 丢光缓冲。开关关掉与撞 404 时用 */
    function clear() {
      buffer = [];
      bufferBytes = 0;
    }

    // -------------------------------------------------------------------------
    // 发送
    // -------------------------------------------------------------------------

    /** §5.4：发送这一刻才把原始 `t` 折算到手机端时钟，并标 `cal` */
    function toLine(entry) {
      var raw = entry.raw;
      return {
        seq: raw.seq,
        t: raw.t + (calibrated ? Math.round(offset) : 0),
        batch: raw.batch,
        item: raw.item,
        event: raw.event,
        kv: raw.kv,
        cal: calibrated
      };
    }

    function senderId() {
      if (sender) return sender;
      var api = LP.api;
      sender = (api && api.senderId) ? api.senderId() : null;
      return sender;
    }

    /**
     * 排下一次发送。攒够字节就按最小间隔发，没攒够就等最早那条满 [MAX_WAIT_MS]。
     *
     * **每个等待都锚在一个绝对时刻上，不是「从现在起再等多久」**：本函数在**每次 [write]**
     * 里都会被叫到并 `clearTimeout` 重排，锚在当前时刻的等待会被后来的每一行往后推一次。
     * 退避尤其要命——`failures >= 4` 时它是 [MAX_BACKOFF_MS] 2000 ms，日志行只要以低于 2 s
     * 的间隔持续产生（上传中就是这个密度），定时器就永远排不到触发、回传一直被拖着。
     * 所以退避锚在 [lastSendAt]，与 2 秒兜底锚在 `buffer[0].at` 同理。
     */
    function schedule() {
      if (paused || !enabled || flying || !buffer.length) return;
      var now = Date.now();
      var gap = Math.max(0, lastSendAt + MIN_GAP_MS - now);
      var backoff = failures ? Math.min(MAX_BACKOFF_MS, MIN_GAP_MS * Math.pow(2, failures - 1)) : 0;
      var full = bufferBytes >= BYTE_BUDGET;
      var due = full ? gap : Math.max(gap, buffer[0].at + MAX_WAIT_MS - now);
      due = Math.max(due, lastSendAt + backoff - now);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flushSafely, Math.max(0, due));
    }

    function flushSafely() {
      timer = 0;
      try {
        flush();
      } catch (e) {
        flying = null;
      }
    }

    function flush() {
      if (paused || !enabled || flying || !buffer.length) return;

      var take = [];
      var bytes = 0;
      while (take.length < MAX_LINES && buffer.length) {
        // 至少装一条：单条大过整份预算时也得让它走，否则它把后面的全堵死
        if (take.length && bytes + buffer[0].n > BYTE_BUDGET) break;
        var entry = buffer.shift();
        entry.keep = false;
        take.push(entry);
        bytes += entry.n;
        bufferBytes -= entry.n;
      }
      if (!take.length) return;

      flying = take;
      lastSendAt = Date.now();
      post(take).then(guard(onSent), guard(onFailed));
    }

    function post(entries) {
      var lines = [];
      for (var i = 0; i < entries.length; i++) lines.push(toLine(entries[i]));
      return fetch(PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sender_id: senderId(), lines: lines })
      }).then(
        function (response) {
          if (response.ok) return 0;
          throw response.status;
        },
        function () {
          // 连不上、超时、被重置——归一成 0，与真有响应的 4xx 分开（两者的处置方向相反）
          throw 0;
        }
      );
    }

    function onSent() {
      flying = null;
      failures = 0;
      schedule();
    }

    /**
     * 两条方向相反的失败处理（§5.2）：
     *
     * - **404**：开关关了。清空缓冲、不再发，等下一拍 ping 说开了再恢复——**不是永久禁用**
     * - **fetch 直接抛**（status 0）：保留缓冲下次一起发。「手机端没答复」恰恰是要排查的现象
     *   本身，此时自禁用等于在案发瞬间把摄像头关了
     *
     * 其余有响应的 4xx（415 / 413 / 400）是这一批本身不合规，退回去重发只会原样再撞一次：
     * 丢掉这批、保住后面的。
     */
    function onFailed(status) {
      var batch = flying;
      flying = null;

      if (status === 404) {
        clear();
        paused = true;
        return;
      }

      if (status === 0 && batch) {
        failures++;
        for (var i = batch.length - 1; i >= 0; i--) {
          batch[i].keep = true;
          buffer.unshift(batch[i]);
          bufferBytes += batch[i].n;
        }
        trim();
      } else {
        failures = 0;
      }
      schedule();
    }

    // -------------------------------------------------------------------------
    // 卸载兜底（§5.3）
    // -------------------------------------------------------------------------

    /**
     * `pagehide` 里用 beacon 把手上的东西送走，三个坑都在这儿（§5.3）：
     *
     * 1. Blob **显式** `application/json`，否则默认 `text/plain` 撞上 `Router` 的
     *    Content-Type 闸门直接 415。页面是手机发的、同源，不走 CORS，没有预检问题
     * 2. 按 [BEACON_BUDGET] **从最新往前装**，装不下的丢弃、在末条带 `dropped`
     * 3. 检查 `sendBeacon()` 的返回值，`false` 就减半再试一次——`pagehide` 之后页面就没了，
     *    收不到 413 也没有任何补救机会
     *
     * 还在飞的那一批随连接中止生死不明，**重新并进来**：宁可重复也别丢，重复由 `seq` 去重。
     */
    function hide() {
      if (!enabled || paused) return;
      if (!window.navigator || !window.navigator.sendBeacon) return;

      // flying 是从缓冲头部摘走的，时间上更早，拼在前面才保持有序
      var all = (flying || []).concat(buffer);
      clear();
      flying = null;
      if (!all.length) return;

      // `page.hide` 自己也要占一格（MAX_LINES 是含它的总数）
      var room = MAX_LINES - 1;
      var take = [];
      var bytes = 0;
      var dropped = 0;
      for (var i = all.length - 1; i >= 0; i--) {
        if (take.length >= room || bytes + all[i].n > BEACON_BUDGET) {
          dropped = i + 1;
          break;
        }
        take.unshift(all[i]);
        bytes += all[i].n;
      }

      if (!beacon(take, dropped, 0)) {
        // 超配额。只可能怪装多了，减半留较新的那一半再试一次
        var half = take.slice(Math.ceil(take.length / 2));
        beacon(half, dropped + (take.length - half.length), 1);
      }
    }

    function beacon(entries, dropped, retry) {
      var lines = [];
      for (var i = 0; i < entries.length; i++) lines.push(toLine(entries[i]));
      // 这一行只能带「装了几条、丢了几条、这是第几次」——`sendBeacon` 的返回值要发完才知道，
      // 而那时页面已经没了。第一次的返回值体现为下一份 body 里的 `retry=1`
      lines.push(toLine({
        raw: {
          seq: seq++,
          t: Date.now(),
          batch: null,
          item: null,
          event: 'page.hide',
          kv: clean({ sent: entries.length, dropped: dropped, retry: retry })
        }
      }));
      var body = JSON.stringify({ sender_id: senderId(), lines: lines });
      var blob = new Blob([body], { type: 'application/json' });
      return window.navigator.sendBeacon(PATH, blob) === true;
    }

    // -------------------------------------------------------------------------
    // 开关与时钟（§5.2 / §5.4）
    // -------------------------------------------------------------------------

    /**
     * 每拍心跳的回包（L10）。**log.js 自己不发 ping**：心跳循环在 `app.js` 里，多一条自己的
     * 定时请求只会跟它抢手机端那 16 条工作线程。`rtt` 由调用方测，用来挑最好的那个时钟样本。
     */
    function onPing(body, rtt) {
      var on = !!(body && body.debug_log);

      if (on) {
        // ping 说开着就把 404 那道暂停解掉（§5.2：暂停不是永久禁用）
        paused = false;
        enabled = true;
      } else if (enabled || !known) {
        enabled = false;
        clear();
        flying = null;
        if (timer) {
          clearTimeout(timer);
          timer = 0;
        }
      }
      known = true;

      calibrate(body, rtt);
      schedule();
    }

    /**
     * §5.4：`offset = server_time + rtt / 2 - Date.now()`，**每拍取样、保留 rtt 最小的样本**
     * （NTP 的老办法），不是一次性校准。
     *
     * `server_time` 是在会话单线程 executor 上取的，前面排着一次 `precheck()` 的 2 s dedup
     * 等待时这一拍的 rtt 就是 2 s、偏移误差约 1 s——与要比较的事件同一量级。一次性校准会把
     * 这个误差**固定住整个会话**。
     */
    function calibrate(body, rtt) {
      if (!body || typeof body.server_time !== 'number') return;
      if (typeof rtt !== 'number' || !isFinite(rtt) || rtt < 0) return;
      if (calibrated && rtt >= bestRtt) return;

      var next = body.server_time + rtt / 2 - Date.now();
      if (calibrated && Math.abs(next - offset) > RECAL_MS) {
        write(null, null, 'clock.recal', {
          from: Math.round(offset),
          to: Math.round(next),
          rtt: Math.round(rtt)
        });
      }
      bestRtt = rtt;
      offset = next;
      calibrated = true;
    }

    // -------------------------------------------------------------------------
    // §7.4 事件表
    // -------------------------------------------------------------------------

    /**
     * 启动段。**身份 storage 可用性不是凑数**：隐私模式下 `api.senderId()` 退回内存随机值
     * （`api.js` 那个 catch 分支），F5 就换 `sender_id`、`forgetBatchesOfOtherSenders` 触发、
     * **根本没有孤儿**（变成 409 等 45 s）。两个子情况不分开就会归错因（§7.4）。
     *
     * 探测必须**先读后写**：`restored` 判的是「这个浏览器之前存过 id 没有」，一旦调了
     * `api.senderId()` 就会写进去，之后再问永远是 true。Safari 隐私模式下 `getItem` 不抛、
     * `setItem` 才抛，所以可用性要靠探写来判。
     *
     * **`persist` 必须记**：`storage` 只答「存得进去吗」，答不了「存进了哪一个」。少了它，
     * 「身份退化成按页存」（代码问题）与「隐私模式禁了 storage」（用户环境）在日志里长得一模
     * 一样，都是 `restored=false`——曾经就在这上面归错过因。存哪个由 `api.senderStore()` 定。
     */
    function boot() {
      var storage = true;
      var restored = false;
      var persist = false;
      try {
        var store = LP.api.senderStore();
        persist = store === window.localStorage;
        restored = !!store.getItem('lp_sender_id');
        store.setItem('lp_dbg_probe', '1');
        store.removeItem('lp_dbg_probe');
      } catch (e) {
        storage = false;
      }

      write(null, null, 'page.boot', {
        ua: window.navigator ? window.navigator.userAgent : null,
        sender: senderId(),
        restored: restored,
        storage: storage,
        persist: persist
      });
    }

    /** 连接档变化。§7.4：`heartbeat` **只记状态变化**，调用方（`app.js`）本身就只在变化时叫 */
    function onLink(from, to, missed) {
      write(null, null, 'heartbeat', { from: from, to: to, missed: missed });
    }

    /**
     * 前后台边沿。`away` 为真才补发心跳、之后每一拍带 `away=1`，把手机端对本端的离线宽限撑到
     * 5 分钟（手机端那头记在 `ping` 行的 `away` 上，两边对得上才算真切过去了）。
     *
     * **`away` 必记**：只有选文件引起的隐藏才报，其余隐藏一个请求都不发——那时手机端的 `ping`
     * 行压根不会出现，光看它分不出「没报 away」与「心跳被限流没发出去」。
     *
     * **回来那一边多一个 `unseen_ms`**：它就是「翻不翻中断态」的判据本身。翻没翻不记在这儿
     * ——`queue.halt` 真生效时自己会落一行 `pause at=halt`，而它只在 `uploading` 那档生效，
     * 比这里补一个字段说得准
     */
    function onVisibility(to, unseenMs, away) {
      var kv = { to: to, away: away };
      if (unseenMs !== undefined) kv.unseen_ms = unseenMs;
      write(null, null, 'visibility', kv);
    }

    /**
     * 选完文件、配置回来、预过滤跑完（§7.4：选了几个、本地预过滤各拦了几个、`config=ok|null`）。
     *
     * `applied=false` 是「回包落地前用户已经点了 Send」那一支——`collect` 会整段跳过重算，
     * 这时表里的拒因是按旧配置算的，读的人要知道。
     */
    function onPick(batch, picked, config, applied, dropped) {
      var kv = {
        picked: picked,
        config: config ? 'ok' : 'null',
        applied: !!applied,
        // 表里现在有几条 = 留下来的。被本地预过滤拦下的不在里面（`queue.refilter` 当场丢掉）
        total: batch.items.length,
        queued: 0
      };
      for (var i = 0; i < batch.items.length; i++) {
        if (!batch.items[i].reason) kv.queued++;
      }
      // **各拦了几个只能靠调用方捎过来**：拦下的条目已经不在 `items` 里，这里数不出来。
      // `applied=false` 那一支没跑过重算，没有这一项
      Object.keys(dropped || {}).forEach(function (reason) { kv[reason] = dropped[reason]; });
      write(batch.batchId, null, 'page.pick', kv);
    }

    /** 发起 `batch/start` 的条数（§7.4） */
    function onBatchSend(batch, items) {
      write(batch.batchId, null, 'batch.send', { items: items });
    }

    function onUploadSend(batch, item) {
      write(batch.batchId, item.itemId, 'upload.send', { len: item.size, name: item.name });
    }

    /** 落盘结果。`saved:false` + `cause=unsupported` 在网页端算跳过不算失败（见 `queue.startUpload`） */
    function onUploadDone(batch, item, result) {
      write(batch.batchId, item.itemId, 'upload.done', {
        saved: !!(result && result.saved),
        cause: result ? result.cause : null,
        len: item.size
      });
    }

    /**
     * 上传失败。**`try` 那一栏是这行记录唯一的区分度**：429 `concurrent` / 503 `server_busy`
     * 退回排队最多能连撞 `queue.js` 的 `BUSY_RETRIES`（10）次，而 `code` / `status` / `sent` /
     * `len` 四栏那时完全同形——没有它，读的人只能靠 `seq` 分辨「堵了 10 次」与「一次就过」。
     *
     * 调用方记在 `item.retries++` **之前**（`queue.js` 的 `startUpload` 失败分支），所以首次
     * 失败是 0，第 n 次是 n-1。
     */
    function onUploadFail(batch, item, error) {
      write(batch.batchId, item.itemId, 'upload.fail', {
        code: error ? error.code : null,
        status: error ? error.status : null,
        sent: item.sent,
        len: item.size,
        // 引号是给旧解析器留的：`try` 是保留字，ES5 起才允许它裸着当属性名
        'try': item.retries
      });
    }

    /**
     * 409 `state_conflict` 之后那套自动整批重开的状态迁移（§7.4）。
     *
     * 调用方在改 `batch.reopen` **之前**把旧值传进来，新值这里自己读——`null → pending → done`
     * 三次迁移与「名额已用掉还撞 409」那次（`from === to === 'done'`）就都落在同一行上了。
     */
    function onReopen(batch, from) {
      write(batch.batchId, null, 'batch.reopen', {
        from: from,
        to: batch.reopen,
        used: from === 'done',
        state: batch.state
      });
    }

    /**
     * 队列请心跳去核实一次（`queue.js` 的 `startUpload` 失败分支 → `app.js` 的 `kick`）。
     * 两个调用方：连着 `NETWORK_STREAK_LIMIT` 条以 `network` 收场，或撞上 `occupied`
     * ——后者分不出「真被顶替」还是「手机端刚释放占用」，`streak` 传 `null`。
     *
     * **这一行不是「链路断了」**，断没断由 `heartbeat` 那一行按 `LOST_AFTER_BEATS` 说。
     * 它记的是「谁在什么时候起的疑」，读日志时用来解释紧跟其后的那一拍 `ping` 为什么
     * 早于 5 s 的节拍——没有它，那一拍在时间轴上是凭空冒出来的。
     *
     * **`kicked` 一定要读**：`kick` 撞上在飞的那一拍会直接返回（`app.js` 里那道 `beating`
     * 门闩），此时**不会有新的 ping**。`false` 与 `true` 后面跟着的时序完全不同，少了这一栏
     * 会把「门闩挡住了」误读成「心跳丢了」。
     *
     * 只在计数满的那一刻记一行，不记每一跳：每次失败本身已有 `upload.fail`（§7.5）。
     *
     * `streak` 由调用方传：它是 `queue.js` 的常量，而本文件加载时 `LP.queue` 还不存在（§5.5
     * 第 3 条），与其在这里延迟取一次，不如让本来就攥着它的那一方给。
     */
    function onSuspect(batch, streak, kicked) {
      write(batch.batchId, null, 'link.suspect', {
        streak: streak,
        kicked: kicked,
        state: batch.state
      });
    }

    /**
     * `pending → done` 那次迁移，落在 `resend` 里（换过 `batch_id` 之后）。
     *
     * **单独一个入口是因为这一行要带旧 id**：`batch` 栏记的是新 `batch_id`，`old` 里是作废
     * 的那个。少了它，日志在换 id 这一步会断成互不相干的两截。
     */
    function onReopenDone(batch, from, old) {
      write(batch.batchId, null, 'batch.reopen', {
        from: from,
        to: batch.reopen,
        old: old,
        state: batch.state
      });
    }

    /**
     * 批次级中断的落点（§7.4）。`at` 说是在哪一步落的，`cause` 是这一批停下来的原因
     * （`user` / `no_space` / `conflict` / 断连档）。
     *
     * **`state` 一定要跟着读**：`at='start'` 那一支已经不是暂停了——预检整批没过时批次退回
     * `collecting`、原因记在 `blocked` 上（`queue.sendBlocked`），`cause` 那一格是空的。
     * 光看事件名会以为是中断态那一屏。
     *
     * 原先还有一轴 `pauseCauseHeld`（被断连档盖住的那个原因），随 `relink` 的回卷逻辑一起
     * 撤掉了：现在断连只是 `render` 按当前连接状态现推的显示层，queue 不再留第二个原因。
     */
    function onPause(batch, at) {
      write(batch.batchId, null, 'pause', {
        at: at,
        cause: batch.pauseCause,
        blocked: batch.sendBlocked,
        state: batch.state
      });
    }

    // -------------------------------------------------------------------------
    // 装配
    // -------------------------------------------------------------------------

    exports.ping = guard(onPing);
    exports.link = guard(onLink);
    exports.visibility = guard(onVisibility);
    exports.pick = guard(onPick);
    exports.batchSend = guard(onBatchSend);
    exports.uploadSend = guard(onUploadSend);
    exports.uploadDone = guard(onUploadDone);
    exports.uploadFail = guard(onUploadFail);
    exports.reopen = guard(onReopen);
    exports.reopenDone = guard(onReopenDone);
    exports.pause = guard(onPause);
    exports.suspect = guard(onSuspect);

    window.addEventListener('pagehide', guard(hide));

    // `page.boot` 要等 `api.js` 装好才记得到 `sender_id`。本文件是第一个 `<script src>`，
    // 这个监听器也就排在 `app.js` 的 `start` 前面——启动段的第一行仍然是它
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', guard(boot));
    } else {
      guard(boot)();
    }
  }
})();

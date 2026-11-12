// 一个批次从「用户选中文件」到「全部有结果」的全过程。上传的编排都在这里，怎么画归 render.js。
//
// 分两段，分界线是用户点 Send：
//
// - **攒批**（add / remove）：只动本地列表，跑本地预过滤（白名单、大小、批内去重）。不碰网络。
// - **开传**（send）：这时列表才定型，发一次 `batch/start` 拿预检结果，再开流水泵。
//
// **预检必须在 Send 而不是选中那一刻**：列表在 Send 之前可增可删，而一个 `batch_id` 只能
// `batch/start` 一次，提前发的话用户再动一下列表，预检结果就和要传的东西对不上了。
(function () {
  var LP = window.LP;
  var api = LP.api;

  /** [log] 兜底用的空实现 */
  function noop() {}

  /**
   * 调试日志（§7.4）。`log.js` 跑起来之后，开关关着时全是 no-op、每个入口自带 try/catch，
   * 不会抛回这里。
   *
   * **但 `log.js` 可能根本没跑起来**（自身语法错误、`/assets/log.js` 取不到），那时它内部
   * 那三层护栏一条都不存在、`LP.log` 就是 `undefined`，下面 17 个调用点会挨个抛 TypeError。
   * 第一个是 [send] 里的 `log.batchSend`，位置在 `api.batchStart` **之前**：用户点 Send
   * 直接没反应，**调试开关关着也照样发生**——一个调试设施把被调试的功能打死，正是 §8 铁律
   * 要禁的事。assets 没有编译器也没有 lint，这种错只会在真机浏览器里暴露，所以自带一份兜底。
   *
   * **这张表必须与本文件的调用点一一对应**，少一个就等于没兜：
   * `grep -o 'log\.[A-Za-z]*' queue.js | sort -u`
   */
  var log = LP.log || {
    pick: noop,
    batchSend: noop,
    uploadSend: noop,
    uploadDone: noop,
    uploadFail: noop,
    reopen: noop,
    reopenDone: noop,
    pause: noop,
    suspect: noop
  };

  /**
   * 流水深度（§5.1、§6.4）。**不是并发度**——手机端同时只允许 1 条正在接收字节的上传，
   * 第二条直接 429。这个数说的是「已经发完 body、还在等响应」的条目数上限。
   *
   * **取 1 = 等接收端回了成功/失败才发下一条。** 原先取 3，让「发下一条的字节」与「commit 上一条」
   * （fsync + 字节校验 + 发布）重叠。代价是撞 429 `concurrent` 变成常态：手机端让并发名额与回响应
   * 之间有个窗口，下一条正好插进去就被拒。偶发本来能靠重试兜住，但重试预算只有 [BUSY_RETRIES] 次，
   * 撞满之后 [startUpload] 会把条目**只在网页本地**标失败、不通知手机端，那边就永远停在 `queued`
   * ——真机上表现为接收端「已接收 1 个、剩余 15 个」永远不动。
   *
   * 手机端那一侧也同步修了（名额与状态改成同步让出/落定，见 `TransferSession.onSessionSync`），
   * 两边各堵一半：那边消掉窗口本身，这边不再往窗口里塞。
   *
   * 也顺带解决了封顶的原始动机：不封顶浏览器会一路发到同源连接上限，把手机端 16 条工作线程占满，
   * 心跳抢不到线程就被判 lost。
   */
  var MAX_PENDING = 1;

  /**
   * 连续多少条以 `network` 收场，就催心跳去核实一次链路（`batch.onSuspect` → `app.js` 的 `kick`）。
   *
   * **单条上传的失败推断不出链路状态**：文件在电脑上被删掉与网线拔了，在 xhr 这一层同形
   * （`api.js` 把 `onerror` 一律归成 `network`）。所以这个计数**不下结论**——链路断没断只由心跳按
   * `LOST_AFTER_BEATS` 判，它是本页唯一有资格下这个结论的地方。
   *
   * 曾经它满了就直接 `batch.state = PAUSED; pauseCause = lostCause()`。那句在真断连时是多余的
   * （`render` 本来就把实时 `linkState` 盖在 `pauseCause` 上），在链路好着时是撒谎——2026-09-18
   * 真机上 3 个 `.wv` 各自落盘失败，屏幕报了「连接丢失」而链路一直通着。
   *
   * 取 3 是沿用旧值。**曾经写成 `= MAX_PENDING`**（当时是 3）：流水深度 3 时链路真断，在飞那几条
   * 几乎同时报错、一轮填满。[MAX_PENDING] 改 1（串行）之后这个等式不能再跟着走——跟下去就是
   * 每条 `network` 都催一拍心跳，太吵。
   */
  var NETWORK_STREAK_LIMIT = 3;

  /**
   * 两档「一会儿再来」退回排队重发时的节奏：有在飞的等它结算顺带重泵，
   * 一条都没有就隔这么久再泵。连续超过 [BUSY_RETRIES] 次才算失败。
   *
   * **两档共用一份预算**：429 `concurrent` 与 503 `server_busy` 都是「手机端这会儿腾不出手」，
   * 也都随着在飞的条目结算自己解开，没理由各记各的。10 × 500 ms = 5 s，
   * 真堵过这个数就不是偶发了，落 failed 让用户看见比一直转圈强
   */
  var BUSY_RETRY_MS = 500;
  var BUSY_RETRIES = 10;

  /** 条目在**网页端**的状态。不等于手机端的 §5.4：网页多一个 processing，少 not_sent */
  var STATE = {
    QUEUED: 'queued',
    UPLOADING: 'uploading',
    /** body 发完、等手机端落盘收尾的回包（§6.4）。产品 §4.3 的「上一条还在手机上处理中」 */
    PROCESSING: 'processing',
    SAVED: 'saved',
    FAILED: 'failed',
    SKIPPED: 'skipped'
  };

  var BATCH = {
    /** 攒批中，等用户点 Send。稿子里右上角那句 Ready to send */
    COLLECTING: 'collecting',
    /**
     * 刚选完文件、等 `GET /api/config` 落地的那一段（稿 11631:35384 首次 / 11631:35879 追加）。
     *
     * 本轮选中的文件这时还在 [create] 的 `staging` 里、没进 `items`，所以列表画出来的是**上一轮
     * 已经定型的内容**——首次选文件时那就是空的，整块卡片只有一个转圈。整屏锁住：Send 置灰、
     * Add more files 那行收起、行上的移除按钮不响应（见 `render` 的 `[data-phase]`）
     */
    FILTERING: 'filtering',
    /**
     * Send 按下去了，`batch/start` 在飞。**画的是和 UPLOADING 同一屏**（稿 10252:76598）：
     * 这一档只是那屏刚打开、一条都还没发的那一瞬间，不单独成屏
     */
    PREPARING: 'preparing',
    UPLOADING: 'uploading',
    /**
     * 停下来了但没结束。四种原因见 [create] 的 `pauseCause`；条目原样留着，接着发或整批重开。
     *
     * **版式分两类**：用户自己按停的（`user`）底部没有报错块、按钮是 Done + Resume
     * （稿 10389:20561）；出错停的有报错块、按钮是 Done + Retry（稿 10279:86266）
     */
    PAUSED: 'paused',
    /**
     * 被别的发送端顶替了占用（D16）。**是终态不是暂停**：手机端一换占用方就把上一个发送端的
     * 批次整张删掉（`TransferSession.forgetBatchesOfOtherSenders`），续传撞 `state_conflict`、
     * 重发也没有意义。页面整块切到占用那屏（稿 10657:125615），这一批就地作废
     */
    OCCUPIED: 'occupied',
    /**
     * 用户结束了这一批（结果屏 / 中断态的 Done，[discard] 的落点）。也是终态：条目不再有下文，
     * 迟到的在飞回调靠它挡住。与 [OCCUPIED] 分开是让「占用」保持单义——那一档该画占用屏、
     * 这一档什么都不画（引用已被 `app.js` 清掉），共用一个值的话两义迟早打架
     */
    DISCARDED: 'discarded',
    DONE: 'done'
  };

  /**
   * 拒因，**与 §5.1 的 reason / cause 同名**：两端拒同一件事时用户看到同一句话。
   *
   * 大部分是本地预过滤用的，只有 [UNSUPPORTED] 两条路都会用——选文件时按扩展名拦下的，
   * 和接收端入库时判定收不了的，**是两回事**（产品口径）。靠 `item_id` 分：本地拒的那些
   * 没有 `item_id`，从不进列表也不进结果页计数（见 `render.tally`）。
   */
  var REASON = {
    UNSUPPORTED: 'unsupported',
    TOO_LARGE: 'too_large',
    EMPTY: 'empty',
    DUPLICATE: 'duplicate',
    /** 文件名命中手机端媒体库黑名单（`BlackFileFilter`），名单随 config 下发 */
    FILTERED: 'filtered',
    /**
     * 超出单批条数上限。**只有网页端有这个拒因**：手机端那边条数超限是报文级的 413、整批拒，
     * 不是某一条的事（§5.6）。被拒的条目不会进 `batch/start`，所以它不会上线
     */
    TOO_MANY: 'too_many'
  };

  /** 本地行标识，只用来给 DOM 做稳定 key。`item_id` 是 Send 时才按最终顺序分配的 */
  var nextUid = 1;

  // ---------------------------------------------------------------------------
  // 本地预过滤（§5.1）
  // ---------------------------------------------------------------------------

  function extensionOf(name) {
    var dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  }

  function baseNameOf(name) {
    var dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }

  /** 与手机端 `FileNameSanitizer.clean` 同口径（NFC、去首尾空白与点），否则 ` tone.mp3` 这边放行、那边判 filtered */
  function cleanName(name) {
    var out = name.normalize ? name.normalize('NFC') : name;
    return out.replace(/^[\s.]+|[\s.]+$/g, '');
  }

  /**
   * 手机端媒体库的文件名黑名单，与预检的 `filtered` 同源（`BlackFileFilter.accept`）：
   * `contains` 比整个路径的子串，`equals` 比**去掉扩展名**的文件名、且是全等。
   *
   * 名单随 `GET /api/config` 下发、已经是小写。在网页这边先拦一道，纯粹是为了让用户在选文件
   * 那一刻就知道（进「N files couldn't be added」弹窗），而不是传完之后在结果页看见一条
   * 说不清为什么没成的记录。**手机端预检仍然是权威判定**。
   */
  function blacklisted(config, item) {
    // 两档都比**文件名**，与手机端 `acceptsName(name)` 同口径——手机端收到的本来就只有
    // 裸文件名（条目不带相对路径），网页拿整条路径去比 contains 的话两端结论会对不上
    var name = cleanName(item.name).toLowerCase();
    var i;
    for (i = 0; i < config.nameContains.length; i++) {
      if (name.indexOf(config.nameContains[i]) >= 0) return true;
    }
    var base = baseNameOf(name);
    for (i = 0; i < config.nameEquals.length; i++) {
      if (base === config.nameEquals[i]) return true;
    }
    return false;
  }

  function skip(item, reason) {
    item.state = STATE.SKIPPED;
    item.reason = reason;
    return item;
  }

  /**
   * 按当前 config 把整张列表重算一遍。
   *
   * **每次增删都整表重算，不做增量**：去重是条目之间的关系，删掉一条会让后面同名的那条重新
   * 变得可传，增量维护一张 seen 表迟早对不上。一批最多 2000 条、一趟 O(n)，不值得为它省。
   *
   * **判据顺序跟着手机端预检走**（分类 → 空 → 大小 → 文件名黑名单 → 去重，见
   * `TransferSession` 里那个 `when`）：同一个文件两端给出同一个拒因。被前面几条拦下的不占
   * 去重位——它根本不会被传过去，拿它把后面同名的一条也挡掉是无中生有。
   *
   * **判重看「文件名 + 大小」二元组**，与手机端同源（§5.5）：同名同大小才算重复，同名不同
   * 大小两条都传、第二条由手机端落盘时追 (1)（改名不回传，网页显示的原名不变）。
   *
   * config 为 null（取不到或超时）时**只做批内去重**，白名单与大小上限交给手机端预检兜底：
   * 配置接口抖一下不该让用户选不了文件。
   *
   * **留不下的当场丢出 `batch.items`**：被本地拒掉的文件就是不要了，用户之后删掉同名的那条
   * 也不会把它放回来。留着的代价是列表在用户眼里变成「删了等于没删」——删一条，被挡在门外的
   * 立刻补一条进来，右上角的计数与行数纹丝不动，选了 2100 个就得删满 100 次才看得到第一次变化。
   *
   * **顺序是「先逐条判拒因、再拿放行数卡上限」**：上限数的是放行数，不是选了几个。2100 个里
   * 80 个格式不支持的话，合格的是 2020，超限的就是 20，两档加起来才是弹窗报的 100。
   *
   * **走的是插入顺序，不是表的顺序**（先到先得，理由在函数体里）。
   *
   * @return 本轮丢掉的条数，**按拒因分档**（`{unsupported: 80, too_many: 20}`）。弹窗只要总数
   *   （[droppedTotal]），分档是给 §7.4 `page.pick` 的——条目一丢，日志层就没法再从 `items` 里数
   */
  function refilter(batch) {
    var config = pageConfig;
    // Object.create(null)：文件名叫 constructor 或 __proto__ 时，普通对象上那些键天生为真，
    // 第一个这样的文件会被自己判成重复
    var seen = Object.create(null);
    var dropped = {};

    function drop(reason) {
      dropped[reason] = (dropped[reason] || 0) + 1;
    }

    /** 已放行的条数，用来卡 `max_batch_items` */
    var accepted = 0;
    /** 判下来留得住的，按 `uid` 记账；表的重建在最后一步 */
    var live = Object.create(null);

    // **淘汰按插入顺序判，表的顺序只管显示与发送**：表头是最新加的那一组（见 [collect]），
    // 顺着表走的话「加满之后再加一批」丢掉的会是列表里早就摆着的老条目。先到先得才对得上
    // 「用户没动手删就不会消失」。`uid` 本来就是单调递增的插入序
    batch.items.slice().sort(function (a, b) { return a.uid - b.uid; }).forEach(function (item) {
      // 手机端拒掉的原样留着：本地重算改不了它那边的结论，而它们要继续摆在列表与汇总里
      // （见 [retryFailed]）。也不占 `accepted` 与去重位——一个字节都不会传
      if (item.state === STATE.SKIPPED) {
        live[item.uid] = true;
        return;
      }
      item.state = STATE.QUEUED;
      item.reason = null;
      item.kind = null;
      // **`item_id` 也一并清掉**：[send] 在发预检前给所有 queued 条目按最终顺序分配过 id，
      // 而 413 那一档回来要重跑本趟（见 [send]）；这一轮筛完顺序已经变了，留着旧 id 的话
      // 下一次 Send 重编时两边对不上。**不在 [skip] 里做**：那边还有 [applyPrecheck] 与入库判
      // 不支持两个调用点，它们拒的条目恰恰要留着 id 才画得出来。清 id 是本趟的事
      item.itemId = null;

      var file = item.file;
      if (config) {
        var ext = extensionOf(file.name);
        // hasOwnProperty：kinds 是普通对象，叫 constructor 的扩展名会在原型上查到东西
        var kind = Object.prototype.hasOwnProperty.call(config.kinds, ext) ? config.kinds[ext] : null;
        if (!kind) return drop(REASON.UNSUPPORTED);
        item.kind = kind;
        if (file.size === 0) return drop(REASON.EMPTY);
        if (file.size > config.maxFileSize) return drop(REASON.TOO_LARGE);
        if (blacklisted(config, item)) return drop(REASON.FILTERED);
      }

      // 大小写不敏感，与手机端的索引口径一致（§5.5：小写文件名 → 大小）
      var key = file.name.toLowerCase() + '/' + file.size;
      if (seen[key]) return drop(REASON.DUPLICATE);
      // 条数上限按**放行的**条目数算，和手机端判 413 的是同一个数（§5.6）。超出的在这里就拒掉，
      // 而不是让整批撞上 `batch/start` 的 413——那会把前 2000 条一起丢掉，而且网页那时只看得到
      // 一个 HTTP 错误码，会把它当断连报给用户
      if (config && config.maxBatchItems && accepted >= config.maxBatchItems) {
        return drop(REASON.TOO_MANY);
      }
      // 放在拒因之后：被拒的条目一个字节都不会传，不该占着去重位把后面同名的那条也挡掉
      seen[key] = true;
      accepted++;
      live[item.uid] = true;
    });

    batch.items = batch.items.filter(function (item) { return live[item.uid]; });
    return dropped;
  }

  /** 把 [refilter] 的分档拒因加总。弹窗只报一个数——那一屏没有分拒因的版式（稿 10279:84821） */
  function droppedTotal(dropped) {
    var n = 0;
    Object.keys(dropped).forEach(function (reason) { n += dropped[reason]; });
    return n;
  }

  function itemOf(file) {
    return {
      uid: nextUid++,
      file: file,
      /** 报给手机端的原始名，清洗归手机端（§4.1）。列表显示的也是它：改名发生在手机端
       *  落盘那一刻、不回传（§5.5 D19），网页从头到尾只知道用户选的原名 */
      name: file.name,
      size: file.size,
      /** audio / lyrics，决定列表里那个 48px 封面画哪个图标 */
      kind: null,
      /** Send 那一刻按最终顺序分配 */
      itemId: null,
      state: STATE.QUEUED,
      reason: null,
      completedAt: 0,
      sent: 0,
      /**
       * 传到一半被打断了（产品态「发送中断」）。**与 [state] 正交**，这个位只管暂停屏上画灰色
       * 叹号还是空白；三条来路与「为什么是标记位不是状态值」都在 [interrupt]
       */
      interrupted: false,
      /**
       * 这一条是以 `network` 收场的（「没收到响应」）。**只给 [halt] 用**：那一刻才知道到底是
       * 链路断了还是这个文件自己的毛病，断了的话由它把这些条目收回成「发送中断」（见 [halt]）
       */
      netFailed: false,
      /**
       * 历来发出去过的最大字节数，只涨不落。[halt] 据此分「真传到一半」与「只是被拿去探链路」。
       *
       * **与 [sent] 的差别是轮次**：那个只记这一轮，[startUpload] 每次开传归零（整份重传）。
       * 跨轮次的事实得单独记——否则 Retry 一次就把「曾经传过」抹掉了
       */
      sentEver: 0,
      /** 撞 429 退回排队的次数 */
      retries: 0
    };
  }

  // ---------------------------------------------------------------------------
  // 攒批
  // ---------------------------------------------------------------------------

  /**
   * @param handlers 三个回调，**按名字取不按位置取**：[retryFailed] 会拿旧批次重建一个，
   *   直接把旧批次当 handlers 传进来就行 —— 位置参数那种写法漏掉一个不会报错，只会让那个
   *   回调从此静默失效（`onSuspect` 就这么漏过一次）
   */
  function create(handlers) {
    return {
      batchId: api.randomId(),
      state: BATCH.COLLECTING,
      onChange: handlers.onChange,
      /**
       * 占用被顶替时叫一声。**不走 onChange**：占用是页面级的状态不是批次的一档，画哪一屏、
       * 这一批留不留，都归 `app.js` 判（见 [BATCH.OCCUPIED]）
       */
      onOccupied: handlers.onOccupied,
      /**
       * 「连着几条都没收到响应，帮我核实一下链路」。由 `app.js` 接到 `kick()` —— 立刻探一拍心跳，
       * 不等那个 5 s 的定时器。
       *
       * **不叫 onLost**：这里给不出链路结论，只给一个「值得马上查」的信号。是不是真断了由心跳
       * 裁决（连续 [LOST_AFTER_BEATS] 拍失败才算），那是本页唯一有资格下这个结论的地方。
       */
      onSuspect: handlers.onSuspect,
      /**
       * 连续失败攒满、正等心跳给链路结论的那一小段（见 [startUpload] 的 `network` 分支）。
       * **期间 [pump] 停发**，结论回来再决定是接着发还是整批暂停
       */
      verifying: false,
      /**
       * 本轮选中、还没进 [items] 的那批文件（见 [collect]）。**只在 [BATCH.FILTERING] 期间非空**。
       *
       * 存在的理由是「列表不画不定型的中间态」：config 没落地时 [refilter] 只跑得了去重，
       * 先画一版再重算会让用户眼看着列表缩短一次、再挨一个弹窗
       */
      staging: null,
      /**
       * 暂停的原因，决定底部那块说哪句话（`render.pauseHint`）：
       *
       * - `user` —— 用户按了 Stop。**不出报错块**，按钮是 Resume
       * - `no_space` —— 507（§4.4、D17）
       * - `lost` —— 传输中连不上手机，而浏览器自认在线
       * - `offline` —— 传输中本机断网（`navigator.onLine` 为 false）
       * - `conflict` —— 连撞两次 409 `state_conflict`，手机端不认这一批了。**链路是通的**，
       *   所以它不属于 [isLinkCause] 那一类，只是暂时借用 5.3 的文案（docs §8.4）
       *
       * **只记这一批自己停下来的原因，不记「现在断没断」**（§2.6 两轴正交）。后两档是
       * [halt] 在**传输中**写进来的，那时链路就是停下来的原因本身；用户按 Stop 之后才断的网
       * 不进这里——屏幕上要改说「连接断了」是显示层的事，由 `render` 拿当前连接状态盖一层
       * （`render.js` 的 `linkState`），网一回来自己落回这里，不需要备份再还原。
       */
      pauseCause: null,
      /**
       * 撞 409 `state_conflict` 后的自动整批重开：null 没重开过 / `pending` 排着队、等在飞的旧请求
       * 结算完再换 `batch_id`（见 [advance]）/ `done` 用过了。**整批只给一次**：连着两次不认就不是
       * 偶发，第二次落暂停交给用户。`pending` 期间 [pump] 停发、批次留在 `UPLOADING`，屏幕不变
       */
      reopen: null,
      /**
       * `batch/start` 有没有成功过。**决定 Retry 走哪条路**：手机端受理过这一批，剩下的条目在
       * 那边是 `queued` 或可复活的 `not_sent`，重发 `PUT` 即续传；没受理过就只能整批重开。
       */
      started: false,
      /** 上一次 add 有多少条没能加进来，>0 时渲染层弹窗 */
      rejectedNotice: 0,
      /**
       * 上一次 Send 被链路挡下的原因（`lost` / `offline`），非空时渲染层弹窗（稿 11682:41486）。
       * 批次仍留在攒批态，点掉弹窗就能再按一次 Send —— 详见 [send] 的失败分支。
       */
      sendBlocked: null,
      items: [],
      /** 正在发字节的那一条，null 表示闸门空着 */
      sending: null,
      /** 在飞条目的中止句柄，按 uid 存。Stop 时挨个掐掉（协议 §7） */
      aborts: Object.create(null),
      /** 已发出、还没拿到响应的条目数 */
      pending: 0,
      /**
       * 连续以 `network` 收场的条目数，每满 [NETWORK_STREAK_LIMIT] 就清零、催一拍心跳去核实
       * （`onSuspect`）。**拿到手机端任何回包也清零**——有回包就证明链路是通的。
       *
       * 它**不再暂停整批**：链路结论只由心跳下（见那个分支上的注释）
       */
      networkStreak: 0,
      /**
       * `batch/start` 撞 `released` 后自动抢回占用重开的一次性名额（见 [send] 的失败分支）。
       * 用掉就不还——抢回来之后还是 `released` 的话就不是超时释放，再自动重开只会打转
       */
      reclaimed: false,
      /**
       * 埋点：处于进行中（PREPARING / UPLOADING）的累计毫秒数，与正在累计的这一段的起点（0 = 没在累计）。
       * 是 `sender_transfer_complete` 的 `duration`，也是 `speed_kbps` 的分母；暂停、中断后的等待不计入
       */
      activeMs: 0,
      activeSince: 0,
      /**
       * 结果页点过几次 Retry（`sender_transfer_complete` 的 `retry_count`）。0 = 首次上传。
       * [retryFailed] 整体重置批次时手动带过去，暂停态的 Retry 与 Resume 不算
       */
      retryCount: 0,
      /** 前几轮的累计（见 [flowOf]），首轮为 null。同 [retryCount]，由 [retryFailed] 带过去 */
      flow: null
    };
  }

  /** 等绘制的上界。可见标签页两拍 rAF 最慢也就几十毫秒，到这个数说明它压根没在绘制 */
  var PAINT_WAIT_CAP_MS = 200;

  /**
   * 整页只取一次的配置，[refilter] 直接读它。取不到时是 null，不入账、下一轮再试。
   *
   * **必须随页面冻结，不是省一次请求**：本地拒掉的条目当场丢出表、无从追溯（见 [refilter]），
   * 已放行的就不能再被另一份配置重判——每次选文件重取的话，中途收紧的配置会让表里早就摆着的
   * 条目无声消失，「用户没动手删就不会消失」这条就破了。改了配置刷新网页才生效（§5.1）
   */
  var pageConfig = null;

  function configOnce() {
    if (pageConfig) return Promise.resolve(pageConfig);
    return api.config().then(function (config) {
      pageConfig = config;
      return config;
    });
  }

  /**
   * 等浏览器把转圈真画到屏幕上。
   *
   * **必须双 rAF**：第一拍跑的是 `render` 那次合帧 flush，它只把转圈写进 DOM，绘制在这一拍之后。
   * 单拍就往下走的话，校验（同步、条目多时几百毫秒）把这一帧整个堵死，转圈一次都到不了屏幕
   * ——用户看到的是页面卡住然后列表直接换掉，稿 11631:35879 那一屏等于不存在。
   *
   * **也必须有超时**：标签页切到后台时 rAF 被节流到一秒一拍甚至根本不跑，而这一下卡的是整条
   * 收文件的路——用户回来会看到批次永远停在转圈那一屏。后台本来也没有绘制可等，直接往下走。
   */
  function painted() {
    // 谁先到谁 resolve，后到的那个是空操作
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
      setTimeout(resolve, PAINT_WAIT_CAP_MS);
    });
  }

  /**
   * 把一批文件收进批次并跑本地预过滤。[add] 与 [retryFailed] 共用——两边只差埋点和文件从哪
   * 来，收进来之后的处理一模一样。
   *
   * **分两段，中间是 [BATCH.FILTERING] 那一屏转圈**（稿 11631:35384 首轮 / 11631:35879 追加）：
   * 新选的文件先搁在 `staging` 里不进 `items`，等配置到手、转圈也真画出去了才一次推入、一次
   * 重算。首轮不能「先按旧配置画一版」——那会儿 [pageConfig] 还是 null，[refilter] 只跑得了
   * 去重，用户会先看到一个没过滤的长列表，配置一到列表缩短、再挨一个弹窗。
   *
   * 转圈盖住的是**校验**（见 [painted]）。首轮还顺带盖住取配置，那一段有硬上界：`api.config`
   * 自带 2 s 超时且取不到回 null 不抛，最坏是 2 s 后按「没有配置」落地——列表照出，只是没跑
   * 白名单过滤，交给手机端预检兜底。
   *
   * **本地预过滤拒掉的当场丢掉**，不进 `items`（见 [refilter]）。数量通过 [rejectedNotice] 弹窗
   * 一次告知，之后无从追溯——表里从此只剩「还打算传的」与预检拒掉的（那些带 `item_id`、要画）。
   */
  function collect(batch, files, onFiltered, more) {
    var picked = files.length;
    batch.staging = Array.prototype.slice.call(files);
    batch.state = BATCH.FILTERING;
    batch.onChange(batch);

    // 配置与「转圈已经画出去」并行等：首轮取配置那一下本来就盖过了这两帧，追加那几轮配置在手、
    // 等的就是这两帧
    Promise.all([configOnce(), painted()]).then(function (ready) {
      var config = ready[0];
      // 落地前这一批可能已经作废（被顶替、用户收场）。Send 在转圈期间是灰的，
      // 所以不会再像从前那样撞上「已经开传了」
      if (batch.state !== BATCH.FILTERING) {
        // §7.4 `page.pick` 的另一支：这一批没熬到落地就作废了，`staging` 里那几个
        // 一条都没进 `items`。`applied=false` 与下面那支的差别就在这儿
        log.pick(batch, picked, config, false);
        return;
      }
      // **插到表头**：Add 行常驻列表最上面，转圈也顶着它那个位置，新选的就该紧贴着从那儿出来，
      // 而不是掉到列表最底下。表的顺序同时就是发送顺序（[send] 按表序分配 `item_id`）
      var fresh = batch.staging.map(itemOf);
      batch.items = fresh.concat(batch.items);
      batch.staging = null;
      // 一次算清：新选的与表里原有的一起过一遍，本轮拦下的都算进这个数
      var dropped = refilter(batch);
      batch.rejectedNotice = droppedTotal(dropped);
      // 重算结果已落定、状态还没翻回攒批态的那一帧。只有 413 那条路用得上（见 [send]）
      if (onFiltered) onFiltered(batch);
      batch.state = BATCH.COLLECTING;
      batch.onChange(batch);
      // §7.4 `page.pick`：记在重算之后——按旧配置那一版的拒因数字还会被重算冲掉。
      // **分档拒因只能由这里捎过去**：拦下的条目已经不在 `batch.items` 里，日志层数不出来
      log.pick(batch, picked, config, true, dropped);
      // 413 那条路传 `[]` 只重算、不是一次选择，不报
      if (picked) reportPicked(batch, fresh, dropped, more);
    });
    return batch;
  }

  /**
   * 追加一批文件。空态的「+」与列表里的「Add more files」走同一条路
   *
   * @param more 是从「Add more files」进来的，埋点分 `sender_add_more_selected` 与 `sender_file_selected`
   */
  function add(batch, files, more) {
    if (batch.state !== BATCH.COLLECTING) return batch;
    return collect(batch, files, null, more);
  }

  /**
   * 用户点掉弹窗上的 OK。**两种提示共用这一条**：「N 个文件加不进来」与「Send 被链路挡下」
   * 共用同一块 DOM、同一个 OK 键，渲染层也就只回得来一个 `dismiss` 回调。两个标志同时非空
   * 在界面上走不出来（弹窗挡着，按不到 Send），一起清掉不会吞掉还没看过的提示。
   */
  function dismissDialog(batch) {
    batch.rejectedNotice = 0;
    batch.sendBlocked = null;
    batch.onChange(batch);
    return batch;
  }

  /**
   * 发送前逐条移除。删掉之后整表重算：条数上限按放行数算，少一条就腾出一个名额，`item_id`
   * 也要跟着作废（见 [refilter]）。**被拦下的不会因此回来**——它们当初就没进表。
   */
  function remove(batch, uid) {
    if (batch.state !== BATCH.COLLECTING) return batch;

    for (var i = 0; i < batch.items.length; i++) {
      if (batch.items[i].uid === uid) {
        batch.items.splice(i, 1);
        break;
      }
    }
    refilter(batch);
    batch.onChange(batch);
    return batch;
  }

  // ---------------------------------------------------------------------------
  // 预检
  // ---------------------------------------------------------------------------

  function isQueued(item) {
    return item.state === STATE.QUEUED;
  }

  function queuedItems(batch) {
    return batch.items.filter(isQueued);
  }

  // ---------------------------------------------------------------------------
  // 埋点（发送端，经 `api.event` 由手机端代报）
  // ---------------------------------------------------------------------------

  function isActive(batch) {
    return batch.state === BATCH.PREPARING || batch.state === BATCH.UPLOADING;
  }

  /**
   * 进入进行中时调，已在累计就不动：自动重开换 `batch_id` 那一下不是停顿。
   * 用单调时钟：`Date.now()` 遇上系统改时间会算出负时长，整条 complete 被手机端回 400 丢掉
   */
  function runClock(batch) {
    if (!batch.activeSince) batch.activeSince = performance.now();
  }

  function pauseClock(batch) {
    if (!batch.activeSince) return;
    batch.activeMs += performance.now() - batch.activeSince;
    batch.activeSince = 0;
  }

  /**
   * `speed_kbps`：已成功上传的字节 ÷ 进行中时长。不满 1 秒或一个都没成功时不给——
   * 那点样本算出来的速度没有意义，给了反而拉偏均值
   */
  function speedOf(bytes, activeMs) {
    if (activeMs < 1000 || bytes <= 0) return null;
    return Math.round((bytes / 1024) / (activeMs / 1000));
  }

  /**
   * 按分类点数，键即埋点属性名。歌词按 `kind` 认；`kind` 为空是没取到配置、本地过滤整个跳过，
   * 一律算音乐
   */
  function kindCounts(items) {
    var counts = { offline_music_count: 0, lrc_music_count: 0 };
    items.forEach(function (item) {
      if (item.kind === 'lyrics') counts.lrc_music_count++; else counts.offline_music_count++;
    });
    return counts;
  }

  /** 这一轮的结果现数，一趟数完 */
  function tally(batch) {
    var counts = { saved: 0, savedBytes: 0, failed: 0, skipped: 0 };
    batch.items.forEach(function (item) {
      if (item.state === STATE.SAVED) {
        counts.saved++;
        counts.savedBytes += item.size;
      } else if (item.state === STATE.FAILED) {
        counts.failed++;
      } else if (item.state === STATE.SKIPPED) {
        counts.skipped++;
      }
    });
    return counts;
  }

  /**
   * 整次上传（首次 Send 加之后每次结果页 Retry）截至这一轮的累计：待传的分类计数取首轮的——Retry 那一轮
   * 只是其中失败的那部分重传；成功数、成功字节、进行中时长是前几轮的加上这一轮的。
   *
   * [retryFailed] 会把成功的条目摘出列表、再整体重置批次，前几轮的这几个数只能靠 `batch.flow` 带过去。
   * 跳过的条目一直留在列表上、失败的全被重传，所以这两个数不用带，[tally] 的现数就是累计
   *
   * @param now 这一轮的 [tally]
   */
  function flowOf(batch, now) {
    var prev = batch.flow || { kinds: kindCounts(batch.items), saved: 0, savedBytes: 0, activeMs: 0 };
    return {
      kinds: prev.kinds,
      saved: prev.saved + now.saved,
      savedBytes: prev.savedBytes + now.savedBytes,
      activeMs: prev.activeMs + batch.activeMs
    };
  }

  /** 退回攒批态：再按 Send 是新的一次上传，前几轮的累计与重试次数不往下带 */
  function freshUpload(batch) {
    batch.retryCount = 0;
    batch.flow = null;
  }

  /**
   * 上传从进行中停下来的那一刻：结算进行中时长，报 `sender_transfer_stopped`。
   *
   * **在改状态之前调**：判据是「这会儿还在进行中」。已经停着的不再报——用户按 Stop 之后又断网、
   * PUT 回 410 之后心跳又回 410，都是同一次停下。`succeed_count` 说的是停下那一刻：已发完字节、
   * 还在等回执的那几条之后可能再成功，不算进去
   *
   * @param reason user_stop / network / receiver_disconnected / no_space / conflict / occupied / unknown
   */
  function stopped(batch, reason) {
    if (!isActive(batch)) return;
    pauseClock(batch);
    var now = tally(batch);
    api.event('sender_transfer_stopped', batch.batchId,
      { reason: reason, succeed_count: now.saved }, speedOf(now.savedBytes, batch.activeMs));
  }

  /**
   * `sender_transfer_complete`：**整次上传截至这一轮结束的累计**（见 [flowOf]），每一轮报一次，
   * `retry_count` 分得出是第几轮。成功 + 失败 + 跳过 = 待传总数，跳过数与结果页上的一致
   */
  function completed(batch) {
    var now = tally(batch);
    var flow = flowOf(batch, now);
    api.event('sender_transfer_complete', batch.batchId, {
      offline_music_count: flow.kinds.offline_music_count,
      lrc_music_count: flow.kinds.lrc_music_count,
      succeed_count: flow.saved,
      failed_count: now.failed,
      skipped_count: now.skipped,
      // 单调时钟给的是小数，手机端只收整数毫秒
      duration: Math.round(flow.activeMs),
      retry_count: batch.retryCount
    }, speedOf(flow.savedBytes, flow.activeMs));
  }

  /**
   * 本地拒因 → `error` 的取值，**顺序即拼接顺序**（与 [refilter] 的判据顺序一致），手机端也按
   * 这个顺序重排一次。0 字节归 `filesize`：两者都是大小不合格
   */
  var REJECT_ERRORS = [
    [REASON.UNSUPPORTED, 'filetype'],
    [REASON.TOO_LARGE, 'filesize'],
    [REASON.EMPTY, 'filesize'],
    [REASON.FILTERED, 'filtered'],
    [REASON.DUPLICATE, 'duplicatefile'],
    [REASON.TOO_MANY, 'toomanyfile']
  ];

  /**
   * `sender_file_selected` / `sender_add_more_selected`：**只数本轮新选的**。进了列表的按类别计，
   * 本轮拦下的计 `failed_count`，拒因去重后拼成一串
   *
   * @param fresh 本轮新建的条目（有的已被 [refilter] 拦下、不在 `items` 里了）
   */
  function reportPicked(batch, fresh, dropped, more) {
    var inList = Object.create(null);
    batch.items.forEach(function (item) { inList[item.uid] = true; });
    var props = kindCounts(fresh.filter(function (item) { return inList[item.uid]; }));
    props.failed_count = droppedTotal(dropped);
    var errors = [];
    REJECT_ERRORS.forEach(function (pair) {
      if (dropped[pair[0]] && errors.indexOf(pair[1]) < 0) errors.push(pair[1]);
    });
    if (errors.length) props.error = errors.join(',');
    api.event(more ? 'sender_add_more_selected' : 'sender_file_selected', batch.batchId, props);
  }

  /** 不经 [queuedItems] 中转：一次空判不该滤出一个整数组，advance 每次结算都会来问一趟 */
  function hasQueued(batch) {
    for (var i = 0; i < batch.items.length; i++) {
      if (isQueued(batch.items[i])) return true;
    }
    return false;
  }

  /** 批内序号补零。宽度跟着批次大小走：50 条是 01，2000 条是 0001 */
  function itemIdOf(index, total) {
    var out = String(index + 1);
    var width = String(total).length;
    while (out.length < width) out = '0' + out;
    return out;
  }

  /**
   * 列表在这一步**才最终确定**（产品 §4.2）：条目会减少。名字不变——预检不回传落盘名，
   * 网页显示的始终是用户选的原名（§5.5 D19）。
   *
   * **`rejected` 在产品口径上只有 `duplicate`**：其余四种拒因（unsupported / empty /
   * too_large / filtered）网页自己判得了，判据全在 `GET /api/config` 里，选文件那一刻就拦掉、
   * 走「N files couldn't be added」弹窗；只有「手机上已经有这个文件」是网页看不见的。
   *
   * 手机端那四种**不删**（配置下发慢半拍、有人绕过网页直接打接口都得兜住）。真回来了这里照样
   * 收，只是结果页只有「已存在」一个桶，会把它计进去——一个按设计不可达的角落，不值得再开一类。
   */
  function applyPrecheck(batch, result) {
    batch.items.forEach(function (item) {
      if (!isQueued(item)) return;

      var reason = result.rejected[item.itemId];
      if (reason) skip(item, reason);
    });
  }

  /**
   * `batch/start` 没成：**退回攒批态、弹窗说原因**（稿 11682:41486）。一个字节都没发出去，
   * 列表也还是原样，不落中断态——那一屏是给「传到一半断了」的。
   *
   * **换 `batch_id` 是这里的要害**：退回的攒批态允许 [add] / [remove]，用户改完列表再按 Send
   * 会按新顺序重编 `item_id`，而同 id 重发拿回的是第一次的结果、手机端那张表纹丝不动
   * （`TransferSession.startBatch` 的幂等键）——两边 `item_id` 从此错位，大小不等撞 409
   * `length_mismatch`，恰好相等就是把这个文件的字节写进另一个文件的名下。
   *
   * `log.pause` 排在 `onChange` 之前：落点仍叫 `start`，但这已经不是暂停了——`state=collecting`
   * 与 `blocked` 两个字段说的就是「退回攒批态、按钮还能再按」，别照着 `pause` 这个名字去找中断态。
   *
   * 两处调它，差别只在旧那张表要不要补一发 `cancelBatch`（见各自的调用点）。
   */
  function backToCollecting(batch, cause) {
    // 进门时还在 PREPARING：点了 Send、批次没开起来，按停下报。两处调用的 cause 都是链路那一类
    stopped(batch, 'network');
    freshUpload(batch);
    batch.batchId = api.randomId();
    batch.state = BATCH.COLLECTING;
    batch.sendBlocked = cause;
    log.pause(batch, 'start');
    batch.onChange(batch);
  }

  /**
   * 用户点 Send。列表到这里才定型，`item_id` 也是这时候才分配的
   *
   * @param clicked 用户点的那一下（`app.js`），报 `click_send`。[resend] / [retryFailed] 是程序自己重开，不带
   */
  function send(batch, clicked) {
    if (batch.state !== BATCH.COLLECTING) return batch;

    var queued = queuedItems(batch);
    if (!queued.length) return batch;
    // 按下那一刻要传的条数，也就是本地预过滤之后还排着的
    if (clicked) api.event('click_send', batch.batchId, kindCounts(queued));

    queued.forEach(function (item, index) {
      item.itemId = itemIdOf(index, queued.length);
    });

    // 「上一次 Send 被挡下了」这个标志到此为止：新一轮 Send 本就该把它重置。不清的话，
    // 万一它在别处被 stranded（弹窗先被藏掉、OK 再也按不到），下一帧签名一变就是一层
    // 说着「连接断了」的全屏遮罩盖在刚开始的上传上
    batch.sendBlocked = null;
    batch.state = BATCH.PREPARING;
    runClock(batch);
    batch.onChange(batch);

    // §7.4 `batch.send`：发起 `batch/start` 的条数
    log.batchSend(batch, queued.length);

    // `source` 恒为 'files'：页面只有一条选文件入口（同 [add]）。协议侧 `BatchSource` 仍收
    // folder / drop，那是对局域网上任意客户端的入参容错，不是这里还留着第二条路
    api.batchStart(batch.batchId, 'files', queued).then(
      function (result) {
        // **回包落地前这一批可能已经不在 PREPARING 了**：用户点了 Done、占用被顶替（见
        // [discard]）、或者按了 Stop。终态与暂停都不该被一个迟到的成功回包翻回 UPLOADING——
        // 那会让泵对着一张手机端已经删掉的批次挨个发 PUT，各自撞 409 `state_conflict`
        if (batch.state !== BATCH.PREPARING) return;
        applyPrecheck(batch, result);
        batch.started = true;
        batch.state = BATCH.UPLOADING;
        batch.onChange(batch);
        advance(batch);
      },
      function (error) {
        if (batch.state !== BATCH.PREPARING) return;
        // 手机端根本没受理这一批（见 [isNotAdmitted]）：页面级接管、就地作废（见 [BATCH.OCCUPIED]），
        // 画哪一屏由 [linkStateFor] 分。用户在原生文件选择器里待过一阵、回来点 Send 撞上的多半是
        // `disconnected` —— 那段时间里手机端用户按了 Disconnect
        if (isNotAdmitted(error.code)) {
          evict(batch, error.code);
          return;
        }
        // 占用方超时释放了、还没人接手（手机端 [BatchStartResult.Released]）：这一批仍是我们的，
        // 催一拍心跳抢回占用再整批重开——**一个字节都没传，重开是免费的**（同 [resend]）。
        // 可达路径：重开预算用尽转 `PAUSED('conflict')` 之后用户点 Retry，`resend` 的 `batch/start`
        // 排在 `app.js` 那一拍 kick 之前发出，来不及先抢回占用。
        //
        // 屏幕留在 `PREPARING` 等结论（≤3 s，转圈本来就在转），不闪一下攒批态
        if (error.code === 'released' && !batch.reclaimed && batch.onSuspect) {
          batch.reclaimed = true;
          batch.onSuspect(function (linkState) {
            // **死批不再动**：裁决回 `busy` 时 `app.js` 已就地作废这一批，而 [resend] 进门先把
            // `state` 设成 `COLLECTING`、把 `DISCARDED` 覆盖掉，`send` 那道门就拦不住了，
            // 于是从一张看不见的批次上发出幽灵 `batch/start`。判据同本处理器进门那句
            if (batch.state !== BATCH.PREPARING) return;
            // 网真断了就按下面那档走：退回攒批态、弹窗说原因。**不补 `cancelBatch`**——
            // 手机端这一批压根没受理过（占用方是空的），没有要收尾的表
            if (isLinkCause(linkState)) {
              backToCollecting(batch, linkState);
              return;
            }
            resend(batch);
          });
          return;
        }
        // **413 单独一档**：条数或字段长度超限（`BatchStartRoute` 的报文级判据），不是断连。
        // 本地那道条数闸门包在 [refilter] 的 `if (config)` 里，`GET /api/config` 取不到就整个
        // 蒸发，整批于是撞上服务端的 413——[refilter] 那段注释预言的正是这一幕。重取配置、
        // 整表重算，超出的落 [REASON.TOO_MANY]，走既有的「N 个文件加不进来」弹窗，用户改完
        // 再自己按 Send。传 `[]` 是这一轮不添新文件、只重算；换 id 的理由见 [backToCollecting]
        if (error.code === 'payload_too_large') {
          pauseClock(batch);
          freshUpload(batch);
          batch.batchId = api.randomId();
          collect(batch, [], function (filtered) {
            // 一条都没多拒 → 这个 413 不是条数那档（单条名字过长、或整个报文超 `maxBody`），
            // 重算解决不了。仍得给个说法，否则再按 Send 就是无声地又撞一次
            if (filtered.rejectedNotice <= 0) filtered.sendBlocked = lostCause();
          });
          return;
        }
        // 预检整批没过（断连）：一个字节都没发出去，列表也还是原样，走 [backToCollecting]
        // ——这里连批次都没开起来，摆一个 Retry 反而要用户去理解「这批到哪一步了」。
        //
        // 旧那张表补一发 `cancelBatch` 收尾：手机端没受理过是 no-op，受理过的则把 queued 转终态、
        // 汇总归零——否则它既没有出口（攒批态只有 Send，`finish` 那道 `state === PAUSED` 不放行），
        // 又不会自愈（只有换设备才触发 `forgetBatchesOfOtherSenders`）。best-effort：这条路上网络刚断，
        // 多半也发不出去，但那时错位的字节本来也到不了手机端，真正有害的「回包丢了」那一支它送得出
        //
        // **503 `server_busy` 也落这一档**：同样一个字节都没发、手机端也没受理，说法借 5.3
        // 那对（§8.4）——「现在传不了、过会儿再试」这个结论是对的
        api.cancelBatch(batch.batchId);
        backToCollecting(batch, lostCause());
      }
    );
    return batch;
  }

  // ---------------------------------------------------------------------------
  // 流水泵
  // ---------------------------------------------------------------------------

  /**
   * 能发就发一条。两道闸门：batch.sending 保证同时只有一条在发字节，batch.pending
   * 把「发完了还没拿到响应」的条目压在 [MAX_PENDING] 以内。
   */
  function pump(batch) {
    if (batch.state !== BATCH.UPLOADING) return;
    // 自动重开排着：旧 `batch_id` 已经作废，再发一条只是多撞一次注定的 409（见 [advance]）
    if (batch.reopen === 'pending') return;
    // 起疑了、正等心跳核实链路：**先别再发**。理由见 [startUpload] 里设它的地方
    if (batch.verifying) return;
    if (batch.sending || batch.pending >= MAX_PENDING) return;

    var next = null;
    for (var i = 0; i < batch.items.length && !next; i++) {
      if (isQueued(batch.items[i])) next = batch.items[i];
    }
    if (next) startUpload(batch, next);
  }

  /** 推进一步，顺带判有没有全部结束 */
  function advance(batch) {
    // 死批（被顶替 / 用户已收场）是终态：既不该再发，也不该把剩下的条目算成「全部结束」翻进结果页。
    // 已结算的同理：迟到的回执再走一遍结束分支，就会多报一条 `sender_transfer_complete`
    if (batch.state === BATCH.OCCUPIED || batch.state === BATCH.DISCARDED || batch.state === BATCH.DONE) return;
    // 自动重开排着队：**等在飞的旧请求全部结算再换 `batch_id`**。提前换的话上一代那几条回来时
    // 认的还是老 id、各自撞一次 409，而那时重开名额已用掉——它们会把刚开好的新批次打回暂停。
    //
    // **`UPLOADING` 这道门不能省**：用户在 409 到重开之间按了 Stop（窗口只有几秒，但按得中），
    // 批次这会儿是 `PAUSED(user)`，最后一条在飞的结算回来照样走到这里——替他重开就是把他刚
    // 做的决定吃掉，屏幕从暂停态自己跳回传输中。重开名额留着不还：他点 Retry 时 `started` 已被
    // 409 分支置 false，走的是 [resend]，那条路自己会把 `pending` 消费成 `done`
    if (batch.reopen === 'pending' && batch.pending === 0 && batch.state === BATCH.UPLOADING) {
      resend(batch);
      return;
    }
    pump(batch);
    // **结论没出就不算结束**：凑满 streak 的恰好是最后一条时，不挡就当场判 DONE，而随后
    // [halt] 会被它自己的 `state !== UPLOADING` 守卫挡掉——中断态与 Resume 一起丢了。
    // 回执两支都有出口（通着补一次 [advance]，断了转 PAUSED），冻不住。
    // 排在 [hasQueued] 那趟扫描之前：冻结期间每条在飞的结算都会走到这儿，`pump` 自带守卫、
    // 早返回不改变结论
    if (batch.verifying) return;
    if (batch.pending > 0 || hasQueued(batch)) return;
    // 暂停态下也没有待传条目了，就是真结束了——用户没有东西可以恢复
    pauseClock(batch);
    batch.state = BATCH.DONE;
    completed(batch);
    batch.onChange(batch);
  }

  /**
   * 断连是哪一种。**浏览器自己知道网卡断没断**：`navigator.onLine` 为 false 就是本机断网
   * （空态 2.4 / 中断态 5.4），否则是连不上手机（2.3 / 5.3）——两边该看的网不是同一头，
   * 文案也就不能共用。古董浏览器没有这个属性时按 `lost` 走，那句话对两种情况都不算错。
   *
   * **两处共用这一份**：这里定的是上传失败当场的暂停原因，`app.js` 的心跳判定断连时也要它。
   * 分家的话同一次断网会在空态屏和暂停提示上说两句不同的话（`render.LINK` 与
   * `render.pauseHint` 认的是同一组 cause）。
   */
  function lostCause() {
    return window.navigator && window.navigator.onLine === false ? 'offline' : 'lost';
  }

  /**
   * 这一档是不是「链路断了」那一类（稿 5.3 / 5.4），与批次自己的原因（5.2 / 5.5）相对。
   *
   * **三处共用，收的东西不同但认的是同一组值**：`app.js` 判心跳给的连接状态、`render.js`
   * 判当前 `linkState` 与终态批次的 `pauseCause`。queue 自己反倒不用了——断连那一层
   * 不再写进批次（见 [create] 的 `pauseCause` 注释）
   */
  function isLinkCause(cause) {
    return cause === 'lost' || cause === 'offline';
  }

  /**
   * 「手机端根本没受理」那一组码：`occupied` = 手机在跟别人传，`disconnected` = 手机端用户按了
   * Disconnect 把这一页赶下来。
   *
   * **同 [isLinkCause]，三处共用**：`app.js` 的心跳、本文件 `batch/start` 与 `PUT` 两处失败分支。
   * 两码的**后果**一样（这一批就地作废），所以判据合成一条；**屏不一样**，那半边归 [linkStateFor]
   */
  function isNotAdmitted(code) {
    return code === 'occupied' || code === 'disconnected';
  }

  /**
   * [isNotAdmitted] 的那一组码各自该切哪一档连接态（`render.js` 的 `LINK`）。
   *
   * 与 [isNotAdmitted] 摆在一起、也同样三处共用：那三处都是先问「受理了没有」，紧接着就要问
   * 「那画哪一屏」。分开写在各处的话，第三个码进来要改的是四个地方而不是这一个
   */
  function linkStateFor(code) {
    return code === 'disconnected' ? 'dropped' : 'busy';
  }

  /**
   * 连接态 → `sender_transfer_stopped` 的原因，心跳（经 [discard]）与 [evict] 共用。
   * `self` 是同机自传，传到一半不该撞上，撞上了也说不清是什么，归 unknown
   */
  function stopReasonFor(linkState) {
    if (linkState === 'busy') return 'occupied';
    if (linkState === 'dropped') return 'receiver_disconnected';
    return 'unknown';
  }

  /**
   * [isNotAdmitted] 那一组码的就地作废（见 [BATCH.OCCUPIED]）：还在进行中就先报停下（[stopped] 要在
   * 改状态之前调），再交给 `app.js` 画 [linkStateFor] 分出的那一屏。`batch/start` 与 `PUT` 的失败分支共用
   */
  function evict(batch, code) {
    var linkState = linkStateFor(code);
    stopped(batch, stopReasonFor(linkState));
    batch.state = BATCH.OCCUPIED;
    batch.onOccupied(linkState);
  }

  /**
   * 放开发字节的闸门。**早拒时也要放**：409 / 429 / 507 在读完请求头就判定了，此时 body 往往
   * 还在发，upload 事件会以 error 收场、走不到放闸那个回调，不在这里补一次的话泵就死住了。
   */
  function release(batch, item) {
    if (batch.sending === item) batch.sending = null;
  }

  /** 把一条原地打回排队：状态、进度、两个瞬时标记一次清干净。[interrupt] 也走这儿，只多打一个标记 */
  function requeue(item) {
    item.state = STATE.QUEUED;
    item.sent = 0;
    item.interrupted = false;
    item.netFailed = false;
  }

  /**
   * 传到一半被打断（产品态「发送中断」）。三条来路一个样：用户按 Stop、空间不足、断连。
   *
   * **就是 [requeue] 多打一个标记**：条目仍留在 `queued`，续传次序、[hasQueued] 判空、
   * [pump] 取谁全不受影响，变的只有暂停屏上行尾画叹号还是空白。做成第七个状态值的话那四处
   * 判据都得各加一档，漏一处就是条目卡住不发（sender_states §7 有详述）。
   *
   * 标记由 [startUpload] 在重发那一刻清。
   */
  function interrupt(item) {
    requeue(item);
    item.interrupted = true;
  }

  /**
   * 断连时把一条收回成可重发的样子。**判据只有一个：这一条到底发出过字节没有**——
   * 发过的才是「发送中断」（行尾灰色叹号），没发过的回纯排队、行尾空白。
   *
   * 两处来路共用：[halt] 里按 `netFailed` 收回的那几条，和被 [abortInFlight] 当场掐掉的
   * 在飞那条。判据写两份必然漂——串行发送下断网时 xhr 秒回，泵会在拿到裁决前多烧几条，
   * 它们一个字节都没发，那是探测的代价、不该泄漏到界面上。
   */
  function reclaim(item) {
    if (item.sentEver > 0) interrupt(item);
    else requeue(item);
  }

  /**
   * 一条上传结算后的清账：归还 pending 名额、摘掉中止句柄、放闸、重画。
   *
   * `defer` 是撞 429 / 503 退回排队的那两档用的：**不立刻重泵**——有在飞的等它结算顺带泵，
   * 一条都没有就隔 [BUSY_RETRY_MS] 再泵
   */
  function settle(batch, item, defer) {
    batch.pending--;
    delete batch.aborts[item.uid];
    release(batch, item);
    batch.onChange(batch);
    if (defer) {
      if (batch.pending === 0) setTimeout(function () { advance(batch); }, BUSY_RETRY_MS);
    } else {
      advance(batch);
    }
  }

  function startUpload(batch, item) {
    item.state = STATE.UPLOADING;
    // 整份重传，不是断点续传（§5.4）：每次开传都从 0 起算。两个瞬时标记一并清干净——三条中断
    // 路径的恢复都经过这一句，而且开传前清空之后，这一轮真落 FAILED 时才不会带着上一轮的
    // [netFailed]（`saved:false` 那一支只改 `state`，不碰标记）被下一次 [halt] 误收
    item.sent = 0;
    item.interrupted = false;
    item.netFailed = false;
    batch.sending = item;
    batch.pending++;
    batch.onChange(batch);

    // §7.4 `upload.send`：len 与 name。**文件名原样上报不脱敏**（L8）——排查落盘改名、
    // 黑名单命中这类问题时，名字本身就是证据
    log.uploadSend(batch, item);

    api.upload(
      batch.batchId,
      item,
      function (sent) {
        item.sent = sent;
        // 只涨不落，跨轮次留着（见 [itemOf] 的 `sentEver`）：`sent` 下一轮开传就归零了，
        // 而 [halt] 要问的是「这个文件曾经传出去过字节没有」
        if (sent > item.sentEver) item.sentEver = sent;
        batch.onChange(batch);
      },
      function () {
        // body 发完即放闸，不等响应——响应还在等手机端的 `commit()` 收尾（§6.4 第 3 条）。
        // 等它才发下一条的话，小文件批次的传输与落盘就完全串起来了
        item.state = STATE.PROCESSING;
        item.sent = item.size;
        item.sentEver = item.size;
        // body 已全在手机端，掐 XHR 拦不住它落盘（`finish()` 不看连接）——Stop 只掐正在发字节的那条
        delete batch.aborts[item.uid];
        release(batch, item);
        batch.onChange(batch);
        pump(batch);
      },
      function (abort) {
        batch.aborts[item.uid] = abort;
      }
    ).then(
      function (result) {
        // 有回包 = 链路通着，不论这一条是 saved 还是被判不支持
        batch.networkStreak = 0;
        // §7.4 `upload.done`。**落盘失败（`{saved:false}`）也是 200**，走的就是这一支
        log.uploadDone(batch, item, result);
        if (result.saved) {
          // **`saved` 就是成功，没有第二档**（§6.4 第 4 条）：文件确实落盘了，发送方要的信息
          // 到此为止。「在不在媒体库里」是收方自己的事，入库那一步手机端投出去就不管了
          item.state = STATE.SAVED;
          // 完成的时刻。渲染层据此让这一条先打钩、过一会儿再从列表里消失
          item.completedAt = Date.now();
        } else if (result.cause === REASON.UNSUPPORTED) {
          // 入库时系统不收这个扩展名，落不了盘。**算跳过不算失败**：结果页归「不支持」那一档，
          // 不进「couldn't be sent」，也不给 Retry——再传一次还是收不了。
          // 字节其实已经传过去了，但那是网页这边的实现细节，用户要的结论是「这个文件没进去」
          skip(item, REASON.UNSUPPORTED);
        } else {
          item.state = STATE.FAILED;
        }
        settle(batch, item);
      },
      function (error) {
        // §7.4 `upload.fail`：error.code 与 HTTP 状态。**记在分流之前**——下面几支里有
        // 「退回排队不算失败」的（429 / 503 / 507 / 409），但请求本身确实失败过，
        // 只在真落 FAILED 那一支记的话，重试次数与堵点就全看不见了
        log.uploadFail(batch, item, error);
        // **自己掐掉的那一条**（`aborted` 只有 [abortInFlight] 一个来源）：用户按 Stop 的退回排队
        // 而不是落失败，Resume 时它排在最前、第一个重发。整份重传不是断点续传——手机端那边它是
        // `failed(interrupted)`、暂存已丢，同一发送端重发 `PUT` 即复活（`TransferItem.admitsUpload`）。
        // [discard] 掐的也走这儿，批次已是死批、[advance] 直接返回。
        //
        // 走 [interrupt] 不是 [requeue]：它传到一半被打断，暂停屏上该是灰色叹号。
        //
        // **断路器不看它**：`networkStreak` 数的是「连续几条没有响应」，拿用户自己按的停去凑
        // 一句「连接断了」是撒谎，所以排在下面那句清零之前、也不累加
        if (error.code === 'aborted') {
          reclaim(item);
          settle(batch, item);
          return;
        }
        // **拿到回包就证明链路是通的**，连续计数清零。`network` 是 `api.js` 给「没有响应」的
        // 那一档，只有它累加；下面几条早退分支（507 / 409 / 429 / 503）都是手机端明确回的，一并清
        if (error.code !== 'network') batch.networkStreak = 0;
        // 507 不是这一条的事：手机端没动它、仍是 queued。退回排队、整批转暂停，Resume 时它第一个
        // 重发（§4.4、D17）。同上走 [interrupt]——它也是传到一半停的
        if (error.code === 'no_space') {
          interrupt(item);
          stopped(batch, 'no_space');
          batch.state = BATCH.PAUSED;
          batch.pauseCause = 'no_space';
          log.pause(batch, 'no_space');
          settle(batch, item);
          return;
        }
        // 409 `state_conflict`：手机端**不认这一批了**（进程被杀重开、或批次被 forget——
        // `TransferSession` 把未知 batch_id / item_id 一律归这一档）。必须立刻停泵，理由同 `network`。
        // 然后**自动重开一次**、不推给用户：这些条目一个字节都没发过，重开免费；真落了盘的那些
        // 重开时由预检判 `duplicate`，不会多落一份。
        //
        // **当批次级信号处理**：协议上它也可能是单条被手机端中止（§7），但那条至今没有生产者
        // （`cancelBatch` 只有 `BatchCancelRoute` 一个入口）。真加了单条中止，这里要改成「连续 N 条才停泵」
        if (error.code === 'state_conflict') {
          requeue(item);
          // §7.4 `batch.reopen` 要 `null → pending → done` 每次迁移，所以旧值得在改之前留一份
          var was = batch.reopen;
          // 手机端连这一批都不认，`resume()` 拿老 `batch_id` 再发还是撞：让自动重开与手动 Retry 都落到 [resend]
          batch.started = false;
          if (!batch.reopen) {
            batch.reopen = 'pending';
          } else if (batch.reopen === 'done' && batch.state !== BATCH.PAUSED) {
            // 重开完还撞，就不是偶发了，交给用户。**独立成一档、不借 `lost`**：409 是响应，
            // 到得了就说明链路是通的，混进链路那一类会让 `isLinkCause` 把它当断连处理（结果页
            // 会跟着说「连接断了」）。文案仍借 5.3 那一对，缺口记在 docs §8.4，到了只改
            // `render.pauseHint` 那一臂
            stopped(batch, 'conflict');
            batch.state = BATCH.PAUSED;
            batch.pauseCause = 'conflict';
            log.pause(batch, 'reopen');
          }
          // `was === 'done'` 就是「名额已用掉还撞 409」那次（§7.4 点名要的那一行）
          log.reopen(batch, was);
          settle(batch, item);
          return;
        }
        // 两档「手机端这会儿腾不出手」，退回排队重发、**不算失败**：
        // ① 429 `concurrent`：上一条还在手机上处理中，这一条在那边仍是 queued
        //   （`TransferSession.finish` 让名额那道竞态）
        // ② 503 `server_busy`：16 条工作线程全占着，这一条**连会话层都没进去**——
        //   `LiteHttpServer.rejectBusy` 在 accept 那一层就顶掉了，手机端压根不知道有过这次请求，
        //   重发一定安全。**不能跟着 `network` 去停泵转暂停**：链路好好的，而且在飞的那几条
        //   一结算名额自己就回来了，摆一屏「连接断了」让用户点 Retry 是在让他替服务端等
        if ((error.code === 'concurrent' || error.code === 'server_busy') && item.retries < BUSY_RETRIES) {
          item.retries++;
          requeue(item);
          settle(batch, item, true);
          return;
        }
        item.state = STATE.FAILED;
        // **告诉手机端别再等这一条**（§5.1）。走到这里有两种：重试预算撞满（concurrent /
        // server_busy），或这一条自己失败了（network 等）。不论哪种，手机端那边它仍是 `queued`
        // ——我们这边已经放弃、`advance` 随后可能判整批 DONE，而 [finish] 只在 PAUSED 才清场，
        // 于是接收端界面永远挂着一条不会来的文件。这一枪补在放弃的那一刻，不指望后面谁兜
        if (item.itemId) api.cancelBatch(batch.batchId, [item.itemId]);
        if (error.code === 'network') {
          // 留个记号给 [halt]：真判定断连时，这些条目要从「失败」收回成「发送中断」（灰色叹号
          // 且能续传）。**当场判不了**——`network` 只说明「没收到响应」，是断连还是这个文件自己
          // 的毛病，得等心跳裁决；在这儿就当中断处理的话，文件被删那一档会让 [pump] 对着同一条
          // 无限重发（它取的是第一条 `queued`），整批再也推不动
          item.netFailed = true;
          // **连着几条没响应只是「值得查」，不是「链路断了」**：`network` 的含义是「没收到响应」，
          // 同一个形状既可能是网线拔了，也可能是这几个文件在电脑上被删了（§7 边界表）。所以这里
          // **不下结论、也不暂停整批**——催一次心跳去核实，让唯一有资格下这个结论的地方去下。
          //
          // 曾经这里是 `batch.state = PAUSED; batch.pauseCause = lostCause()`。那句在**真断连时是
          // 多余的**（`render` 本来就把实时 `linkState` 盖在 `pauseCause` 上面，心跳翻档后照样显示
          // 「连接丢失」），在**链路好着时是撒谎**——2026-09-18 真机上 3 个 `.wv` 各自落盘失败，
          // 屏幕就报了「连接丢失」，而链路一直是通的。
          //
          // 催心跳这一下还有个好处：**失败越密催得越勤**，计数每满一轮就催一拍，真断连时心跳会比
          // 干等 5 s 一拍翻档快得多，原先那点「补位」的价值不但没丢，还更准。
          batch.networkStreak++;
          if (batch.networkStreak >= NETWORK_STREAK_LIMIT) {
            batch.networkStreak = 0;
            // **停泵等结论**，不是暂停：`network` 只说明「没收到响应」，断没断由心跳裁决。
            // 不停的话下面那句 [settle] 会立刻 [advance] 发下一条，而 xhr 在网卡断掉时是**秒回**
            // 的（没设 timeout 也拦不住），心跳却要 3 拍 × 3 s 才翻档——这几秒足够把整条队列烧空，
            // [advance] 随后判 DONE 翻进结果页，而规格要的是中断态 + 用户 Retry 续传（§7）。
            // **冻到出结论为止，不是冻一拍**：漏拍不算结论，`app.js` 的 `armNextBeat` 会把回执压到
            // 「这一拍真落到手机端」或「已判定断连」才发。所以真断网时全程只烧 [NETWORK_STREAK_LIMIT]
            // 条——发回一个尚未翻档的旧 `ok` 就会解冻、再烧一轮，那正是这道门要挡的。
            //
            // 只在计数满的这一刻记一行，不记每一跳——每次失败本身已有 `upload.fail`（§7.5）
            askVerdict(batch, NETWORK_STREAK_LIMIT);
          }
        } else if (error.code === 'released' || error.code === 'occupied') {
          // 两档都先**停泵问心跳**，不拿一个上传回包下结论（见 [verdictOf]）：
          //
          // - `released`：手机端按宽限期把占用放掉了、没人接手，这一批仍是我们的。一拍 ping
          //   重新占上就接着传（§5.4：`not_sent` 是软终态，同一个 `sender_id` 再发 PUT 即复活）
          // - `occupied`：真被别的浏览器顶替。由 `app.js` 的 `setLink('busy')` 就地作废，不必
          //   这里动手——它拿的是 ping 的结论
          //
          // 预算用尽后两档才分开：`occupied` 回原口径整页切占用屏；`released` 只把这一条留在
          // `failed` 上接着发下一条，**不作废整批**——没人抢走它，作废是白丢用户已传的进度。
          //
          // 先问 `batch.onSuspect`：它就是 [askVerdict] 能不能成事的全部条件，成不了就别动 item
          if (item.retries < BUSY_RETRIES && batch.onSuspect) {
            item.retries++;
            // 退回排队等重发。**重发会撞 409 `state_conflict`**——上面那枪 `cancelBatch` 已经
            // 把它转成 `canceled` 了，自动重开换新 `batch_id` 接得回来，同 [halt] 收回的那几条
            requeue(item);
            // `streak` 传 null：这一行不是连失攒出来的疑（见 `log.suspect` 的 KDoc）
            askVerdict(batch, null);
          } else if (error.code === 'occupied') {
            evict(batch, error.code);
          }
        } else if (isNotAdmitted(error.code)) {
          // 走到这一支的**只可能是 `disconnected`**：`occupied` 已被上面那条
          // `released || occupied` 吃掉了（if/else if 链）。仍用 [isNotAdmitted] 而不是写死
          // 一个码——判据只该有一处，上面那条哪天不再兜 `occupied`，这里自动接住。
          //
          // 与上面两档不同的是**没有转机**：`released` 抢回占用就能接着传、`occupied` 是别人
          // 的事，而这一档手机端永远不再受理这一页（除非换 `page_id`），问心跳也只会得到同一
          // 个 410。所以不停泵问结论，直接就地作废整批，画哪一屏由 [linkStateFor] 分
          evict(batch, error.code);
        }
        settle(batch, item);
      }
    );
  }

  /** 掐掉所有在飞的上传（协议 §7）。discard 与 stop 共用 */
  function abortInFlight(batch) {
    Object.keys(batch.aborts).forEach(function (uid) { batch.aborts[uid](); });
  }

  /**
   * 造一份「等心跳裁决」的回执。唯一的调用方是 [askVerdict]，那边有「谁在什么时候问」。
   *
   * **结论只由心跳下**：链路断没断、占用还在不在，本页只有它有资格说。一个上传回包看到的是
   * 单次结果，据此作废整批就会把「手机端超时释放了占用、还没人接手」误判成「被顶替」
   * （2026-09-21 真机：45 s 释放后 Retry 撞 409，7 s 后的 ping 却是 accepted）。
   *
   * 三种落点：
   * - **通着**：接着发。上一条失败是它自己的毛病（文件被删之类），或占用本来就还是我们的
   * - **断了**：转中断态。**不指望 `app.js` 那一路**——它的 [halt] 挂在 `link` 的变化沿上
   *   （`setLink` 进门就是相等守卫），断网期间用户点 Retry 把批次拉回 `UPLOADING` 时
   *   `link` 一直是 `offline`，那一路一次都不会再跑。[halt] 自带守卫，重复调不亏
   * - **真被顶替**：`app.js` 的 `setLink('busy')` 已经就地作废了这一批，[advance] 撞
   *   `DISCARDED` 自己返回，这里不必分这一支
   *
   * **没接 `onSuspect` 就返回 null**：`verifying` 只由回执清，没人给回执就是永久冻住
   */
  function verdictOf(batch) {
    return batch.onSuspect && function (linkState) {
      batch.verifying = false;
      if (isLinkCause(linkState)) {
        halt(batch, linkState);
        return;
      }
      // 通着 —— 那之前攒的那几条 `network` 就不是链路的错，记号就地作废（判据在 [relink]）。
      // **不能只靠 `app.js` 那一路**：它挂在 `link` 的变化沿上，而「文件在电脑上被删」这一档
      // 链路自始至终是 `ok`、一次都不跳变，[relink] 一次都不会被调到
      relink(batch);
      advance(batch);
    };
  }

  /**
   * 停泵、把回执交给心跳、记一行 `suspect`。[startUpload] 的 `network` 与
   * `released`/`occupied` 两档共用——**三件事必须绑在一起**：`verifying` 只由回执清，
   * 置了它却没把回执递出去就是永久冻住泵（见 [verdictOf]）。
   *
   * `kicked` 是 [kick] 的返回值：被在飞的那一拍挡掉时不会有新的 ping，日志里要分得开。
   *
   * **没接 `onSuspect` 就只记一行、不冻**（[verdictOf] 返回 null）：`verifying` 只由回执清，
   * 没人给回执就是永久冻住
   */
  function askVerdict(batch, streak) {
    var verdict = verdictOf(batch);
    if (verdict) batch.verifying = true;
    log.suspect(batch, streak, verdict ? batch.onSuspect(verdict) : null);
  }

  /**
   * 就地作废一批。被顶替（D16）与用户结束（[finish]）共用——`app.js` 那边把引用一清，这一批就
   * 再也画不出来了（`onChange` 的 `current !== batch` 守卫），但**还在飞的回调手上仍攥着这个
   * 对象**。
   *
   * 两件事：掐掉在飞的上传（用户已经走了，或手机端已经把这一批整张删了，字节再发过去也没有
   * 落点），再落一个终态挡住迟到的回调。守卫只挡住了「画出来」，没挡住「发出去」。
   */
  function discard(batch, linkState) {
    // 心跳判出被顶替 / 被赶时，上传可能还在进行中（PUT 那边还没撞上）。用户点 Done 走 [finish]，不带
    if (linkState) stopped(batch, stopReasonFor(linkState));
    abortInFlight(batch);
    batch.state = BATCH.DISCARDED;
  }

  /**
   * 用户结束这一批（结果屏或中断态的 Done）。先叫手机端别再等，再就地作废：
   *
   * **只有暂停态要打 [api.cancelBatch]**：还在传的（UPLOADING）到不了 Done；传完的（DONE）
   * 那边没有排着的了；攒批态（COLLECTING）手机端根本不知道这一批。Stop 那一步**不能**打——
   * `cancelBatch` 把 `queued` 转成 `canceled` 终态，打完 Resume 就接不回来了
   */
  function finish(batch) {
    if (batch.state === BATCH.PAUSED) api.cancelBatch(batch.batchId);
    discard(batch);
  }

  /**
   * 从外面把一批按下暂停。心跳判定断连时用（`app.js`），是上面那条「上传失败即停泵」的兜底：
   * 连接不是干脆地断掉、而是卡住不动时，XHR 可能一直挂着谁也不报错，只有心跳看得出来。
   *
   * **已经停着的不碰**：那一批自己的原因（`user` / `no_space`）才是它停下来的理由，断连不写进批次。
   * Stop（5.2）/ 507（5.5）之后网才断，屏幕照样换成 5.3 / 5.4、底下那个按下去必然失败的 Resume
   * 照样换成 Retry，但那是 `render` 按当前 `linkState` 现推的一层显示态（PAUSED 档
   * `cause = isLinkCause(linkState) ? linkState : batch.pauseCause`），网一回来自己就没了——不落在
   * `pauseCause` 上，也就不用再备份一份原值等着还原。见 [create] 的 `pauseCause` 注释。
   *
   * 曾经上传那边也有一道对称的守卫（`network` 连失到顶就 `state = PAUSED`，并拿 `state !== PAUSED`
   * 挡住 Stop 时自己 abort 出来的 `onabort` 假断连）。那一整支已经拿掉——上传那边不再下链路结论、
   * 也就不再写 `pauseCause`，假断连无从盖起。现在只剩这一处会因断连改状态，而它同样只动
   * `UPLOADING` 那一档。
   */
  function halt(batch, cause) {
    // **已经停着的不碰**：那一批自己的原因（`user` / `no_space`）才是它停下来的理由，断连只是
    // 盖在上面的一层显示态，由 `render` 按当前连接状态现推（见 `create` 的 `pauseCause` 注释）
    if (batch.state !== BATCH.UPLOADING) return batch;
    stopped(batch, 'network');
    batch.state = BATCH.PAUSED;
    batch.pauseCause = cause;
    // **断连确认了，把烧掉的那几条收回成「发送中断」**（那一态见 [interrupt]）。
    // 判定只能在这儿做：失败当场分不出「链路断了」还是「这个文件在电脑上被删了」（2026-09-18
    // 真机上 3 个 `.wv` 各自落盘失败，链路一直通着），所以那边先落 `FAILED` 让泵能往下走、
    // 只记一个 [netFailed]；等心跳下了结论再回收。收回来它们就重新进了 `queued`，用户点
    // Resume 能接着发——不收的话得等整批收尾、到结果页 Retry 重开新批次才发得出去。
    //
    // **只收 `network` 那几条**：同一批里可能混着真失败的（落盘失败、被删的文件），它们与
    // 链路无关，该留在 `failed` 上。
    //
    // 那一枪 `cancelBatch` 已经打出去了（手机端把这几条转成了 `canceled` 终态），重发时
    // 撞 409 `state_conflict` 会走自动重开、换新 `batch_id` 重来一遍，条目接得回来
    //
    // **分两档**：断网后烧掉的这几条里只有第一条真在传，后面那些是 [NETWORK_STREAK_LIMIT]
    // 这道探测门拿去确认链路的代价（串行发送下网卡一断 xhr 秒回，它们一个字节都没发）。
    // 探测的代价不该泄漏到界面上——没传过的回纯排队，只有真传到一半的才是中断
    batch.items.forEach(function (item) {
      if (item.state !== STATE.FAILED || !item.netFailed) return;
      reclaim(item);
    });
    // **在飞那条也得掐**（协议 §7）：走 `onabort` → `aborted` 分支 → [interrupt]，与上面收回来
    // 的落在同一个态。不掐它就留在 `uploading` 上，屏幕已是中断态而那一行的进度环还在转。
    // 上面那个循环兜不住它——「连接卡住不动、XHR 挂着不报错」那一档一条失败回调都不会有。
    //
    // **位置**：在 `state = PAUSED` 之后，否则回调里的 [advance] 会把批次又推起来；
    // 在日志之后，同 [stop]——`onabort` 是当场回调，顺序反了 `upload.fail` 就记在 `pause` 前面
    //
    // §7.4：`halt` 只在 UPLOADING 上生效，上面那个 return 挡掉的「已经停着又断网」是看不见的
    // ——那一档现在由 `render` 按当前连接状态现推，queue 这边不留痕，日志也就无从记起
    log.pause(batch, 'halt');
    abortInFlight(batch);
    batch.onChange(batch);
    return batch;
  }

  /**
   * 心跳说链路好着时告诉 queue 一声。**只清两个记号、不碰状态**：心跳比它们权威——
   * 下一轮要是又挂，该从头数（见 [startUpload] 的 `networkStreak`）。
   *
   * 两个调用方：`app.js` 在 `link` 跳回非断连档时调（真恢复），以及 [verdictOf] 拿到「通着」
   * 的裁决时调。**后者不能省**：前者挂在变化沿上，而「文件在电脑上被删」这一档链路自始至终
   * 是 `ok`、一次都不跳变。
   *
   * **[netFailed] 也在这儿清**：心跳说链路好着，那之前那几条 `network` 就不是链路的错
   * （文件在电脑上被删是同一个形状）。不清的话记号会一直挂到下一次**真**断连，被 [halt]
   * 连坐收回成「发送中断」——用户 Resume 时反复重发几个必然失败的条目。记号只在「攒出
   * 怀疑」到「心跳下结论」这一小段里有意义，出了这段就该作废。
   *
   * **不还原暂停原因**：断连那一档从来没写进批次，它是 `render` 按当前连接状态盖的一层
   * （见 [create] 的 `pauseCause` 注释），网一回来那一层自己就没了。
   *
   * **也不自动续传**：接着发不发是用户的决定，按钮就在那儿。
   */
  function relink(batch) {
    // 这里不再记日志：`pauseCauseHeld` 那套回卷没有了，本函数没有状态迁移可记。
    // 「网回来了」这件事由 app.js 的 `heartbeat`（ok → lost → ok）覆盖，不会丢
    batch.networkStreak = 0;
    batch.items.forEach(function (item) { item.netFailed = false; });
    return batch;
  }

  /**
   * 用户按 Stop（稿 10279:84821 的二次确认走完之后）。
   *
   * **先改状态再 abort**：abort 触发的失败分支会走到 [settle] → [advance]，那时状态必须已是
   * PAUSED，否则泵会接着挑下一条。
   *
   * 只掐正在发字节的那一条。**掐掉的那条退回排队、Resume 时整份重传**——`api.js` 把自己掐的记成
   * `aborted`、与真断连的 `network` 分开，失败分支据此分流。手机端那边它是 `failed(interrupted)`，
   * 同一个发送端重发 `PUT` 即复活（见 `TransferItem.admitsUpload`）。已发完 body 的不掐，等它们
   * 自己结算。
   */
  function stop(batch) {
    if (batch.state !== BATCH.UPLOADING && batch.state !== BATCH.PREPARING) return batch;
    // 报在这儿而不是 `app.js` 的确认回调里：走过上面那道门才是真停了
    stopped(batch, 'user_stop');
    batch.state = BATCH.PAUSED;
    batch.pauseCause = 'user';
    // 记在 abort 之前：abort 会让在飞那条的 onabort 立刻回调，顺序反了日志里就成了 upload.fail 先到
    log.pause(batch, 'stop');
    // **告诉手机端这一下是用户停的**（§7 ③）：那一侧「按 Stop」与「链路断了」同形。发在
    // abort 之前，与被掐的连接抢先手；到不了就退化回它等 45 s 无心跳自己判
    api.stopBatch(batch.batchId);
    abortInFlight(batch);
    batch.onChange(batch);
    return batch;
  }

  /**
   * 中断态与结果页的 Retry / Resume。**三条路**：
   *
   * - 已结算（[retryFailed]）：结果页那屏。一条排队的都没有了，要重来的是已失败的。
   * - 暂停 + 手机端受理过（[resume]）：剩余条目在手机端是 `queued`，或是发送端离线后被标的
   *   `not_sent`——那是软终态，同一个 `sender_id` 再发 `PUT` 即复活（§5.4）。直接接着发。
   * - 暂停 + 没受理过（[resend]）：`batch/start` 就没过，手机端根本不知道有这一批，重发 `PUT`
   *   只会撞 409 `state_conflict`。得整批重开。
   *
   * **暂停态带不走已经失败的那几条**：它们的 `item_id` 在手机端已经是终态，同一个 `batch_id`
   * 里换不回来。要重试得等这一批全部结算、到结果页再点一次。两段式是协议定的（§5.4）。
   *
   * @param word 屏上那个键的词（`resume` / `retry`，见 render 的 `retryAction`），埋点按它分
   *   `click_resume` / `click_sender_retry`。报在门后：连点的第二下批次已离开暂停态 / 结果页，不报
   */
  function retry(batch, word) {
    if (batch.state !== BATCH.DONE && batch.state !== BATCH.PAUSED) return batch;
    api.event(word === 'resume' ? 'click_resume' : 'click_sender_retry', batch.batchId);
    if (batch.state === BATCH.DONE) return retryFailed(batch);
    return batch.started ? resume(batch) : resend(batch);
  }

  /**
   * 结果页那屏的 Retry：**失败的那几条就地重开成新的一批、立刻发出去**。
   *
   * §5.4 写死了重试永远是新批次新 `item_id`、手机端不复用身份，而 `failed` 是硬终态——不像
   * `not_sent` 那样同一个 `sender_id` 再发个 `PUT` 就能复活。所以换 `batch_id`、条目退回排队。
   *
   * **不经 [collect]**：那几条本来就在表里、也早就按同一份配置筛过了（配置整页只取一次，见
   * [configOnce]），重算必然零拒；而 [collect] 那一段转圈是「选完到展示之间」的过渡，Retry
   * 没有「选」这一步。
   *
   * **成功的不带走、跳过的原样留着**：成功的一个字节都不会重传，留着只会被新这一批的汇总再数
   * 一遍；跳过的两档重试不动（`duplicate` 再传还是重复，`unsupported` 再传还是收不了），但要
   * 留在列表与汇总里——点完 Retry 那一屏还得答得出「刚才跳过了几个」。
   *
   * **就地改这个对象、不新建一个**，同 [resend]：`app.js` 手上攥的是这个引用，换对象的话它
   * 那道 `current !== batch` 守卫会把重开后的第一帧当成迟到的回调丢掉。
   */
  function retryFailed(batch) {
    // §7.4 点名要的 `retryFailed` 落点。**记在整体重置之前**：下面那趟 `Object.keys(fresh)`
    // 会把 `batchId` 与两轴暂停原因全归零，之后再记就只剩一个新 id，接不回前因
    log.pause(batch, 'retryfailed');
    var keep = batch.items.filter(function (item) { return item.state !== STATE.SAVED; });
    var retries = batch.retryCount + 1;
    // 摘掉成功的条目、整体重置之前把累计算好，下一轮接着往上加（见 [flowOf]）
    var flow = flowOf(batch, tally(batch));
    // 按 [create] 的初值整体重置（新 `batch_id`，`started` / `reopen` / 暂停原因归零），别手抄字段
    // 列表。旧批次整个当 handlers 传回去 —— 几个回调是 `app.js` 装上的、与批次内容无关，[create] 按
    // 名字取，这里就不必跟着回调的增减改一遍
    var fresh = create(batch);
    Object.keys(fresh).forEach(function (key) { batch[key] = fresh[key]; });
    batch.retryCount = retries;
    batch.flow = flow;
    batch.items = keep.map(renewed);
    return send(batch);
  }

  /**
   * 把一条翻回可发的样子，**交出一个新对象**（[retryFailed] 专用，整表 `map` 过来）。
   * 拿 [itemOf] 重造再补回 `uid` 与 `kind`，不手抄「要清哪几个字段」——往条目上加字段时
   * 不必记得回来改这里。`uid` 是插入序（[refilter] 的先到先得靠它），`kind` 决定行上那个
   * 图标而本路不跑 [refilter]，两个都得留。
   *
   * 跳过的不翻：它们不重传，只留在列表与汇总里，`item_id` 跟着旧批次一起作废。
   *
   * **别叫回 `requeue`**：同一个 IIFE 里已经有一个原地改写的 [requeue]，两份同名声明会被
   * 提升成后者覆盖前者，409 / 429 那两条重试路径就会调到这一份——原条目一个字段都不改，
   * 于是永远卡在 `uploading` 上，[pump] 取不到、[advance] 判整批 DONE（曾经如此）。
   */
  function renewed(item) {
    if (item.state === STATE.SKIPPED) {
      item.itemId = null;
      return item;
    }
    var fresh = itemOf(item.file);
    fresh.uid = item.uid;
    fresh.kind = item.kind;
    return fresh;
  }

  /** 用户清理完空间 / 网络回来之后接着传。剩余条目还在 queued，不需要重新选文件（产品 §4.4） */
  function resume(batch) {
    // 两轴归零之前留一行，否则「从什么原因恢复的」就丢了
    log.pause(batch, 'resume');
    batch.state = BATCH.UPLOADING;
    batch.pauseCause = null;
    runClock(batch);
    // **旧的链路核实到此作废**：用户按下 Retry 就是新的意图，不该让他等一个为上一轮攒的结论。
    // 不清的话 [pump] 会被 `verifying` 挡住，屏幕显示传输中却最多干等两拍（`app.js` 的
    // `armNextBeat` 把回执压到出结论才发）。窗口很窄——冻着的时候屏幕还是传输中，得先 Stop
    // 再 Retry 才撞得上——但撞上就是「按了没反应」。
    // 迟到的那份回执照样会来，至多再 [advance] 一次；那时已结算的话由 [advance] 的终态守卫挡掉
    batch.verifying = false;
    batch.onChange(batch);
    advance(batch);
    return batch;
  }

  /**
   * 整批重开：退回攒批态、**换一个新 `batch_id`**，再走一遍 `send`。
   *
   * 换 id 不是洁癖。上一次 `batch/start` 失败在网页这边只是「没拿到响应」，手机端有没有受理到
   * 是不知道的——断连那一支尤其可能是「它收了、回包丢了」。拿同一个 id 再发一次就成了重复受理，
   * 而协议上一个 `batch_id` 只能 `batch/start` 一次（§5.1）。反正一个字节都没传，重开是免费的。
   */
  function resend(batch) {
    var was = batch.reopen;
    var old = batch.batchId;
    batch.batchId = api.randomId();
    batch.pauseCause = null;
    // 自动重开的落点也在这儿。排着的那次到此用掉，**不还回去**：还的话新批次再撞 409 又自动重开，死循环
    if (batch.reopen === 'pending') batch.reopen = 'done';
    // §7.4 `pending → done` 那次迁移。**换 id 之后才记**，且把旧 id 带上——新旧两个
    // `batch_id` 在这一行里对上，日志才串得起来；只记一个的话时间线在这儿直接断开。
    // `was` 为空是「`batch/start` 就没过、用户手动 Retry」那条路（见 [retry]），它没有重开
    // 名额可言，落在 `batch.send` 上就够了，不该混进重开的状态机
    if (was) log.reopenDone(batch, was, old);
    batch.state = BATCH.COLLECTING;
    return send(batch);
  }

  // 只导出真有人调的。`queuedItems` / `MAX_PENDING` 只在本文件里用，摆到外面就是没人读的
  // 公开面；`REASON` 出去是给 render 的结果页计数认 `DUPLICATE` 那一档——reason 的字面量
  // 只此一份，render 不该自己再声明一个 'duplicate'
  LP.queue = {
    STATE: STATE,
    BATCH: BATCH,
    REASON: REASON,
    lostCause: lostCause,
    isLinkCause: isLinkCause,
    isNotAdmitted: isNotAdmitted,
    linkStateFor: linkStateFor,
    create: create,
    discard: discard,
    finish: finish,
    add: add,
    remove: remove,
    dismissDialog: dismissDialog,
    send: send,
    halt: halt,
    relink: relink,
    stop: stop,
    retry: retry
  };
})();

// 装配：首屏文案、选文件入口、保活心跳。业务在 api.js / queue.js / render.js 里，
// 这里只负责把它们接起来。
(function () {
  var LP = window.LP;
  var api = LP.api;
  var queue = LP.queue;
  var render = LP.render;

  /** [log] 兜底用的空实现 */
  function noop() {}

  /**
   * 调试日志（§7.4）。**`log.js` 没跑起来时 `LP.log` 是 `undefined`**（自身语法错误、
   * `/assets/log.js` 取不到），它内部那三层护栏一条都不存在：[setLink] 的 `log.link` 与
   * [beat] 的 `log.ping` 会抛 TypeError，把心跳和整个连接状态机一起打死。assets 没有编译器
   * 也没有 lint，这种错只会在真机浏览器里暴露——一个调试设施不许有这种能力（§8 铁律）。
   *
   * **这张表必须与本文件的调用点一一对应**：`grep -o 'log\.[A-Za-z]*' app.js | sort -u`
   */
  var log = LP.log || { link: noop, ping: noop, visibility: noop };

  /** §5.1：网页每 5 s 一次。手机端久未见心跳就把占用方标离线并释放占用 */
  var HEARTBEAT_MS = 5000;

  /**
   * 切后台之后多久算被手机端放掉，与手机端 `sender_away_grace_seconds` 同一个数。
   * 两边各存一份：这一份只用来判回前台要不要翻中断态，判偏了两个方向都自愈（见 [start]）
   */
  var AWAY_GRACE_MS = 5 * 60 * 1000;

  /**
   * 没报 `away` 的那次隐藏按这个判，与手机端 `sender_offline_seconds` 同一个数。
   * **必须跟着 [awayGranted] 分档**：手机端只对报过 away 的隐藏多等 5 分钟，其余 45 s 就把条目
   * 翻 `not_sent` 了，网页仍拿 5 分钟去比的话会漏翻中断态、屏幕上继续说「传输中」
   */
  var OFFLINE_GRACE_MS = 45 * 1000;

  /**
   * 连着几拍心跳都没打通就当断连（哪些算没打通，见 [beat] 的错误分支）。
   *
   * 3 拍是为了不误杀：一拍最多 3 s 超时 + 5 s 间隔，三拍最坏 24 s，仍在手机端 45 s 释放占用
   * 之前——网络只是抖一下的话来得及自己恢复，正在传的一批不会被一次抖动打断。
   */
  var LOST_AFTER_BEATS = 3;

  /** 当前批次。null 表示还停在空态 */
  var batch = null;

  /**
   * 与手机端的关系，七档（§2）：`unknown` 还没打通过 / `ok` 占用在手 / `busy` 被别人占着、
   * 或本浏览器另有一页开着（D16）/ `self` 这一页就开在接收端那台手机上 /
   * `dropped` 被手机端用户按 Disconnect 赶下来 /
   * `lost` 连不上手机 / `offline` 本机断网。
   * **不是 ok 就不给选文件**——`batch/start` 要求先注册占用方，否则直接 409。
   *
   * 后五档**整页接管**，画的是空态那一屏（见 [setLink]）。
   */
  var link = 'unknown';

  /** 连着几拍没打通了。一拍成功就清零 */
  var missed = 0;

  /** `sender_page_enter` 报过没有：每次页面加载只报一次，在第一拍打通时 */
  var entered = false;

  /** `sender_connect_failed` 报过的原因。每个页面、每种原因只报一次，否则每 5 s 一拍都会报 */
  var failuresReported = Object.create(null);

  /**
   * 下一轮选完文件报哪个：点的是「Add more files」还是空态那个入口。在点击那一刻记下，
   * 选择器被取消就没有下文，下一次点击会覆盖它
   */
  var pickingMore = false;

  /**
   * 进隐藏那一刻的 [missed]。回前台恢复它而不是清零——只作废隐藏期间攒的那几拍，前台攒的
   * 不该跟着丢。隐藏期间有一拍打通就跟着 [missed] 一起清，那时这份快照已被推翻
   */
  var missedWhenHidden = 0;

  /** 漏拍归零。**两个一起清**，理由见 [missedWhenHidden]。回前台那一支是恢复不是归零，不走这里 */
  function clearMissed() {
    missed = 0;
    missedWhenHidden = 0;
  }

  /**
   * 最后一次心跳真落到手机端的时刻，与手机端 `TransferSender.lastSeenAtMillis` 同一个量。
   * **只有 ping 成功那一支更新**：409 `occupied` 在会话层早退，压根没碰那个字段
   */
  var lastSeenByPhone = 0;

  /** 下一拍心跳的定时器。网卡回来时要先掐掉它再立刻探一拍，否则会把循环叉成两条 */
  var beatTimer = 0;

  /**
   * 有一拍正在飞没有。[kick] 靠它判断还要不要再起一条 —— [beatTimer] 在飞的那段时间里是 0，
   * 光看它的话 `clearTimeout` 无从下手，叉成两条循环也就拦不住（见 [kick]）
   */
  var beating = false;

  /**
   * 等心跳出结论的回执（[kick] 的 `onVerdict`）。
   *
   * **漏拍不是结论，不发**（见 [armNextBeat] 的门）：头两拍没打通时 [missed] 还没到
   * [LOST_AFTER_BEATS]，[link] 挂着旧的 `ok`，把它发回去等于告诉 `queue`「链路好着呢，接着发」，
   * 冻住的泵就会解冻、再烧几条、再冻——真断网时一轮轮循环，规格要的「剩余条目留着等 Retry」
   * 就守不住（§7 边界表）。
   *
   * **但冻结必须有出口**：连着漏拍到 [LOST_AFTER_BEATS] 必然 [setLink] 成 `lost` / `offline`，
   * 那一档也发，所以等待者最多压两拍（≈ 10 s，远小于手机端 45 s 的占用释放），而且压着的
   * 这段时间心跳照跑，占用不会因此过期
   */
  var verdicts = [];

  var pickFiles = null;

  /**
   * 点了「选择文件」、还没回到前台。**只有这期间的隐藏才报 `away`**——去系统选择器挑文件是
   * 传输流程的一部分，用户切走干别的不是。
   *
   * **不设时限**。上一版拿「点击后 1 s 内隐藏」当判据，真机上一次都没命中：选择器什么时候
   * 抢到前台由系统说了算，MI 6 上隔了好几秒，猜多少都是错的。改成一路举到回前台为止。
   *
   * 桌面端点 + 弹的是模态框、页面根本不隐藏，所以除了回前台，[onPicked] 也落它——那条路
   * 覆盖「选完了」，剩下「弹框里取消又不碰页面」一种，最多让之后第一次切标签页蹭到一次宽限
   */
  var picking = false;

  /** 这次隐藏报没报 `away`。决定回前台拿哪个宽限去比（见 [OFFLINE_GRACE_MS]） */
  var awayGranted = false;

  /**
   * 切走那一刻有一拍普通心跳在飞，等它结算完补一拍 `away`（[armNextBeat]）。那一拍带的是
   * `away=0`，手机端每收一拍都无条件重写宽限，它后到就把 5 分钟打回 45 s——而用户正在选择器里
   */
  var awayResendPending = false;

  /**
   * 换一档连接状态。后五档整页接管、画的是空态那一屏（见 `render.link`）。
   *
   * **断连时不 reload**：整页 HTML 是从手机上取的，`location.reload()` 在断网时拿不回来，
   * 用户会卡在浏览器自己那张错误页上、只能手动重试。自画那一屏才能让心跳在后台继续跑、
   * 网一回来自己恢复。
   */
  function setLink(next) {
    if (link === next) return;
    // §7.5：`heartbeat` 只记状态变化。上面那道相等守卫本身就是「只在变了的时候」，
    // 记在它之后，一次三分钟的会话不会因为心跳留下 72 行
    log.link(link, next, missed);
    link = next;
    // **先落连接状态再走下面几条路**：中断态底部那块由 `render` 的 `linkState` 现推
    // （断着网说 5.3 / 5.4，网回来落回批次自己的原因），下面任何一条触发的重绘都得用上新值。
    // 摆在末尾的话 `halt` 那一路画出来的还是上一档
    render.link(next);
    // 被顶替就地作废这一批。手机端一换占用方就把上一个发送端的批次整张删了
    // （`TransferSession.forgetBatchesOfOtherSenders`）：续传会撞 `state_conflict`，
    // 留着列表只是给用户一个按不响的 Retry。占用那屏本来就是空态版式，先退回去再画。
    //
    // **`self` 与 `dropped` 同理**：三档都是「这一批在手机端已经没了、也拿不回占用权」。`self`
    // 不是纯防御——手机端网卡地址快照还空着时会放行一拍，那一拍里选文件按钮是活的、够开出一个
    // 批次，下一拍才翻 `self`；漏掉就掉进下面「网回来了」那支，把刚画的接管屏盖掉、泵还接着发。
    // `dropped` 见心跳里那条 `disconnected`
    if (next === 'busy' || next === 'self' || next === 'dropped') {
      dropBatch(next);
    } else if (queue.isLinkCause(next)) {
      onDown(next);
    } else if (batch) {
      // 网回来了。断网时被 [onDown] 收起来的才需要盖回去，所以先过 [yieldsToEmpty]。
      // **FILTERING 除外**：它用的就是空态版式、设备那块要留着（稿 11631:35384），而 [render.open]
      // 第一件事就是把设备区藏掉，[flush] 的首轮分支又按约定不碰它——判据与 [onChange] 里那道
      // `state !== FILTERING` 同源，两处要一起改
      if (yieldsToEmpty(batch.state) && batch.state !== queue.BATCH.FILTERING) render.open();
      queue.relink(batch);
    }
    // **补一帧**：连接状态是中断态底部那块的输入之一（`render` 的 `linkState`），换了档就得重画。
    // 不能指望 `halt` 的 `onChange`——批次已经停着时它直接返回、一个事件都不发，那正是「用户按了
    // Stop 之后才断网」这一档。网回来那一路还要顺带把断网期间落下的状态变化（halt 转暂停、
    // config 回包）画出来。
    //
    // **唯独「让位空态」那一路不补**：[onDown] 刚用 [render.close] 把批次面板收起来、露出空态，
    // 这一帧会把它重新画出去——`flush` 按 `perfect` 无条件写 `els.batch.hidden`，而 picker / batch /
    // done 是 `<main>` 下的同级 section，于是两块屏同屏（COLLECTING 是空态 + 攒批列表，DONE 全成
    // 是空态 + 完成屏）。这两档断连后不再产生 queue 事件，[onChange] 那道同款判据兜不住，要等
    // 链路恢复走 [render.open] 才纠正——整个断连窗口都停在坏版式上，而那正是用户唯一需要看清
    // 「连接断了」的时候。判据只能有一份，见 [yieldsToEmpty]
    if (batch && !(queue.isLinkCause(next) && yieldsToEmpty(batch.state))) render.show(batch);
  }

  /**
   * 断着网时这一档要不要**把整页让给空态那两屏**（§2.6）。
   *
   * 两档要：还没开传的选择态、已经传完的完成态。两件事让它们归一档：
   *
   * ① **这两屏上连接状态没有承载体**——手机插画那一块进选择态就整个收掉了（§3.6），
   *   结果页同理。不切走的话用户压根看不出断没断。
   * ② **手机端那边没有等着我们的活**——选择态一次 `batch/start` 都没发过，完成态这一批每条都有结果了。
   *   没有会过期的服务端状态，盖掉就不会弄丢任何东西，网一回来原样放回。
   *
   * 中间那一段（发送态、中断态）不盖：那一屏有自己的报错槽，还剩几条、传了多少都要留在眼前（中断态 5.3 / 5.4）。
   *
   * **三处读它**：[onDown] 盖、[setLink] 揭（同一条路末尾那次补帧还得避开刚盖上的那两档）、
   * [onChange] 管断网期间的重绘。判据只能有一份——漏掉一处的表现是屏幕与连接状态对不上，
   * 而且只在断网那几秒里看得见。
   */
  function yieldsToEmpty(state) {
    return state === queue.BATCH.COLLECTING || state === queue.BATCH.DONE ||
      state === queue.BATCH.FILTERING;
  }

  /**
   * 断连当场去哪（§2.6）。让位的那两档见 [yieldsToEmpty]；其余留在列表上由中断态表达。
   *
   * WiFi 抖 24 秒就冲掉用户挑了半天的几百个文件没有任何道理，所以盖屏不丢批次；
   * 真会丢批次的只有占用被顶替那一档（§2.2，那是手机端真把批次删了）。
   */
  function onDown(cause) {
    if (!batch) return;
    if (yieldsToEmpty(batch.state)) render.close();
    else queue.halt(batch, cause);
  }

  /**
   * 丢掉当前批次回空态。**被顶替时用**——用户点 Done 走 `queue.finish` 那条路（见 [onAction]）
   *
   * @param linkState 上传还在进行中的话，queue 按它报 `sender_transfer_stopped` 的原因
   */
  function dropBatch(linkState) {
    // 清引用之前先让 queue 落终态：还在飞的那些回调手上攥的是这个对象，光把引用清掉只挡得住
    // 「画出来」，挡不住「接着发」（见 `queue.discard`）
    if (batch) queue.discard(batch, linkState);
    batch = null;
    render.reset();
  }

  // ---------------------------------------------------------------------------
  // 心跳
  // ---------------------------------------------------------------------------

  /** `sender_page_enter` 的 `type`：扫码进来的 URL 带 `?source=qr`，其余按地址是域名还是 IP 分 */
  function connectType() {
    if (/[?&]source=qr(&|$)/.test(window.location.search)) return 'qrcode';
    return /\.local$/i.test(window.location.hostname) ? 'domain' : 'ip';
  }

  /** @param error receiver_busy / self_transfer / receiver_disconnected / duplicate_page / unknown */
  function connectFailed(error) {
    if (failuresReported[error]) return;
    failuresReported[error] = true;
    api.event('sender_connect_failed', null, { error: error });
  }

  /**
   * 保活循环，兼断连探测。
   *
   * 用 setTimeout 递归而不是 setInterval：一次 ping 慢了的话 setInterval 会把请求堆起来，
   * 而手机端认的是「最后一次见到」，堆着的请求帮不上忙只会占工作线程。
   *
   * 判出断连之后，正在传的那一批不停在这儿、走中断态（见 [onDown]）：手机端 45 s 后把条目标
   * `not_sent`，那是**软终态**，同一个 `sender_id` 再发 PUT 即复活（§5.4），而 `sender_id`
   * 按浏览器存、这一页没关就还是它。
   */
  function beat() {
    beatTimer = 0;
    // 回包原先「没有消费者」（`api.js` 那句注释），现在有两个：`log.js` 的开关与时钟校准。
    // rtt 在这儿测——`log.js` **不自己发 ping**，它只挑 rtt 最小的那个样本（§5.4）
    var sentAt = Date.now();
    beating = true;
    api.ping().then(
      function (body) {
        var rtt = Date.now() - sentAt;
        log.ping(body, rtt);
        api.noteRtt(rtt);
        clearMissed();
        // **只进不退**：一拍在飞时用户切走，[onVisibility] 已经推到切走那一刻，而这一拍带的是
        // 最多 5 s 前的 [sentAt]——回写等于拿旧证据推翻新的，贴着宽限边界回来就白翻一次中断态
        if (sentAt > lastSeenByPhone) lastSeenByPhone = sentAt;
        if (!entered) {
          entered = true;
          api.event('sender_page_enter', null, { type: connectType() });
        }
        // 断连期间没送出去的埋点，这一拍证明链路通了
        api.flushEvents();
        setLink('ok');
      },
      function (error) {
        // **判据是「这一拍有没有刷新手机端的『最后一次见到』」，不是「有没有收到响应」。**
        // [queue.isNotAdmitted] 那两个码（409 / 410）是唯一真进了会话层、也真被回答了的失败
        // （`TransferSession.ping` 判的）：链路通着，谈不上漏拍。**但两者画的不是同一屏**——
        // 占用是「手机在跟别人传，等会儿再来」，被赶是「手机断开了你，重新连一次」
        if (queue.isNotAdmitted(error.code)) {
          // 占用那一档：占用方离线后释放，下一拍就接手（D16）。
          // 被赶那一档**等不到任何转机**：手机端只在「同 sender_id 换了 page_id」时解除拦截，
          // 而本页实例的 page_id 永远不变。心跳照跑（万一手机端整个停了会话，拦截随之清掉），
          // 但屏幕不会再变，直到用户自己关掉或刷新
          clearMissed();
          connectFailed(error.code === 'disconnected' ? 'receiver_disconnected' : 'receiver_busy');
          setLink(queue.linkStateFor(error.code));
          return;
        }
        // 这一页开在接收端那台手机上。心跳照跑：漏拍要防的是 45 s 释放占用，而这一档没占用可丢
        if (error.code === 'same_device') {
          clearMissed();
          connectFailed('self_transfer');
          setLink('self');
          return;
        }
        // 其余一律算漏拍，**包括那些看着像「服务端好好的、只是拒了我」的码**。ping 这条路还能回
        // 400 / 403 / 404 / 421 / 431 / 500 / 503，除上面那个 `same_device` 外没有一个进过会话层：
        // 403 `bad_origin` 与 421 `bad_host` 被 `SourceGuard` 在分发前拦掉，503 `server_busy` 更早，
        // `rejectBusy` 在 accept 那一层就顶了。它们与 `network`「没有响应」的后果是同一件事——
        // 「最后一次见到」没被刷新，连着 45 s 手机端就释放占用、把排着的条目标 not_sent（§5.4）。
        //
        // 所以这里不列白名单：**漏掉哪个码，页面就会在那个码上永远停在 `unknown`**——绿图标挂着、
        // 加号点不动、一个字都不解释（`render.link` 里 `unknown` 与 `ok` 长得一样），而手机端早
        // 把我们踢了。宁可退化成 5.3 那屏，它至少说了实话。文案也是借 5.3 的「连接断了」，
        // `WebI18n` 里没有「手机忙不过来」这一条（docs §8.4）
        missed++;
        // **隐藏期间不下这个结论**：[LOST_AFTER_BEATS] 那个「最坏 24 s」只在页面全速跑时成立，
        // 而隐藏页的定时器被浏览器限流，三拍能拉到几分钟。回前台重新裁决（见 [start]）
        if (missed >= LOST_AFTER_BEATS && !document.hidden) {
          // 切到「连接断了」那一屏时，这一拍手机端回了话、只是拒了，报一次 unknown。
          // 没有响应的（status 0）报不出去；503 是工作线程一时占满，不算
          if (error.status && error.code !== 'server_busy') connectFailed('unknown');
          var cause = queue.lostCause();
          setLink(cause);
          // **每一拍都把结论压到批次上，不只在变化沿**：[setLink] 进门就是相等守卫，断着网点
          // Retry 时 `link` 一直是这一档，[onDown] 一次都不会再跑。而上传那边没有自己的超时
          // （`api.js` 只挂 `onerror`），对端消失时这一发 PUT 何时报错由系统的连接超时说了算，
          // 可以是几十秒——那段时间屏幕显示传输中，而页面自己早判定断了。
          // `queue.halt` 自带 `state !== UPLOADING` 守卫（也就不会重复记日志），重复调不亏
          if (batch) queue.halt(batch, cause);
        }
      }
    ).then(armNextBeat, armNextBeat);
  }

  /**
   * 排下一拍。**成功与失败两支都得接**：上面那两个回调里除了状态机还挂着 `log.ping` 这样的
   * 旁支，它一旦抛（`log.js` 缺席、或护栏之外的意外），只挂 onFulfilled 的 `.then` 会把异常
   * 变成一个没人接的 rejection——**心跳循环就此永久停摆**。那时页面一直显示「已连接」，而手机
   * 端 45 s 没见心跳就释放占用、把排着的条目标 not_sent，用户侧是静默死亡。
   *
   * 循环续得上比任何一拍的结果都重要，所以两个位置填同一个函数。
   *
   * **[beating] 也在这里落**，理由同上：它挂在 [kick] 的门口，只在成功那支清的话，上面抛一次
   * 就再也进不去了——而 `onSuspect` 恰恰是响应回不来时才叫的，正是最需要 [kick] 的时候
   */
  function armNextBeat() {
    beating = false;
    beatTimer = setTimeout(beat, HEARTBEAT_MS);
    // 补那一拍（见 [awayResendPending]）。守 [awayGranted]：这中间可能已经回前台了
    if (awayResendPending) {
      awayResendPending = false;
      if (awayGranted) api.pingAway(true);
    }
    // **结论回执在重排之后发**：上面那两个回调已经把 [setLink] 走完了，`link` 是这一拍的新值。
    // 一次性取走再逐个调 —— 回执里会 `advance`，那一路可能又攒出新的等待者
    if (!verdicts.length) return;
    // **只有出了结论才发**（见 [verdicts]）。`missed === 0` 就是「这一拍落到手机端了」：成功那支
    // 清零，409 `occupied` 那支也清零——它真进了会话层也真被答了，链路是通的，不该继续冻着。
    // 另一头是已经判定断连，那也是结论。两者都不是就压着，等下一拍
    if (missed !== 0 && !queue.isLinkCause(link)) return;
    var waiting = verdicts;
    verdicts = [];
    for (var i = 0; i < waiting.length; i++) waiting[i](link);
  }

  /**
   * 立刻探一拍，不等排着的那个定时器。网卡回来、或上传那边起疑时用（见 [onPicked] 里的
   * `onSuspect`）。
   *
   * **已经有一拍在飞就什么都不做**：在飞的那一拍本身就是「立刻探一拍」，再起一条只会把保活
   * 循环叉成两条 —— [beat] 进门先把 [beatTimer] 清成 0，这段时间里 `clearTimeout` 无从下手，
   * 而两条链结算时都会重新 `setTimeout`，后排的句柄把前一个盖掉，前一条就再也停不下来了。
   * 上一版只有网卡回来这一个调用方，那时候撞上在飞的一拍是小概率；`onSuspect` 恰恰在响应
   * 回不来的时候叫，不挡的话每叫一声就多一条
   *
   * @return 这一声有没有真探出去。**只给日志用**（`queue.js` 把它记进 `link.suspect`）：
   *   被门闩挡掉时不会有新的 ping，读日志的人得能把这一档与「心跳丢了」分开
   */
  function kick(onVerdict) {
    // **挂在门闩外面**：撞上在飞的那一拍时不另起一条，但回执照样要给 —— 在飞那一拍结算时
    // 一并发。漏掉的话 `queue` 那边会一直冻着泵等一个永远不来的结论
    if (onVerdict) verdicts.push(onVerdict);
    if (beating) return false;
    if (beatTimer) clearTimeout(beatTimer);
    beat();
    return true;
  }

  /**
   * 前后台切换的两个边沿。**心跳不停**：跑得动就一直刷新手机端的「最后见到」，跑不动才由宽限兜底。
   *
   * **只有选文件引起的那次隐藏才发东西**（见 [picking]）：切走补发一拍、回来再补一拍，
   * 中间每一拍由 `api.pingUrl` 现读 [api.setAway] 置的位带上 `away`，不是只报切换那一下
   * （漏报一拍就把手机端的宽限打回 45 s）。其余前后台切换一个请求都不发，心跳照常跑。
   */
  function onVisibility() {
    if (document.hidden) {
      awayGranted = picking;
      missedWhenHidden = missed;
      log.visibility('hidden', undefined, awayGranted);
      if (!awayGranted) return;
      // 乐观推到当下：那一拍是 keepalive、拿不到回包，不推的话本端到期点比手机端早几秒，
      // 白翻一次中断态。推错了也只是不翻屏，点 Retry 照样接得上（条目是 `not_sent` 软终态）
      lastSeenByPhone = Date.now();
      api.pingAway(true);
      // 在飞的那一拍带的是旧档位，后到就把宽限打回去了（见 [awayResendPending]）
      awayResendPending = beating;
      return;
    }
    // 回到前台就不在选文件流程里了，不管这一趟有没有真去成选择器（见 [picking]）
    picking = false;
    // 隐藏期间攒的漏拍作废：那几拍的间隔早就不是 5 s 了。回到进隐藏时的计数而不是零，
    // 理由见 [missedWhenHidden]
    missed = missedWhenHidden;
    var unseen = Date.now() - lastSeenByPhone;
    log.visibility('visible', unseen, awayGranted);
    // **判据是「多久没被手机端看见」不是「离开了多久」**：后台心跳一直通着的话手机端根本没
    // 放手，这时翻中断态是在说一件没发生的事。这个量与手机端清扫判的是同一个，阈值跟着这次
    // 隐藏报没报 away 分档、与它那边一一对应（见 [OFFLINE_GRACE_MS]）。
    // `halt` 只动 `uploading`，攒批态（选文件那个主场景）天然 no-op。
    //
    // **原因走 [queue.lostCause] 不写死 `lost`**：隐藏期间本机 Wi-Fi 断了该是 `offline`，写死会
    // 让中断屏把用户指向错的一侧。`render` 拿实时 `linkState` 盖 `pauseCause` 那层这一刻兜不住
    // ——`offline` 监听器带 `!document.hidden` 守卫，隐藏期间没触发过，`link` 还是旧值
    if (batch && unseen >= (awayGranted ? AWAY_GRACE_MS : OFFLINE_GRACE_MS)) {
      queue.halt(batch, queue.lostCause());
    }
    // 没报过 away 就没有要撤的档，也不补这一拍——非选文件的前后台切换网页什么都不发
    if (!awayGranted) return;
    awayGranted = false;
    api.setAway(false);
    kick();
  }

  // ---------------------------------------------------------------------------
  // 选文件与发送
  // ---------------------------------------------------------------------------

  function onChange(current) {
    // 批次可能已经作废（点了 Done，或被顶替进占用态），而还在飞的那几条上传结算时仍会回调
    // 过来——`queue` 手上攥的是老对象。不挡的话它会把已经收起来的列表重新画出去
    if (current !== batch) return;
    // 断着网时让位给空态那一屏、列表留着等恢复（§2.6）。断连当场走 [onDown]，这里接的是断着网
    // **进入**那两档的情形——结果页点 Retry 退回选择态（`queue.retryFailed`），或最后一条结算完进完成态。
    // `close` 幂等，重复调不亏。中间那一段不盖屏，断网期间的状态变化（halt 转暂停）照常画
    if (queue.isLinkCause(link) && yieldsToEmpty(current.state)) {
      render.close();
      return;
    }
    // 等 config 那一段还用着空态版式（设备那块留着，稿 11631:35384），列表一定型就露批次面板。
    // 每帧都调不亏：[open] 只是四个 hidden 的幂等赋值，而少调一次的代价是首屏切不过去
    if (current.state !== queue.BATCH.FILTERING) render.open();
    render.show(current);
  }

  /**
   * 这一批在手机端没受理，页面级接管（D16）。与心跳撞见同样那两个错归到同一条路上。
   *
   * @param next 切到哪一档 —— `busy`（被别人占了）或 `dropped`（被手机端 Disconnect 赶下来）。
   *   两者都让这一批就地作废，但说的是相反的两件事，屏不共用
   */
  function onOccupied(next) {
    // 不写 `next || 'busy'` 兜底：三个调用点（queue 里 batch/start 一处、PUT 失败分支两处）
    // 都是拿 [queue.linkStateFor] 现算出来传进来的。兜底会把「谁忘了传」这种错悄悄压成 busy
    // 那一屏 —— 而漏传过一次：`setLink(undefined)` 在 `render.link` 那边查不到形状，整屏不换
    setLink(next);
  }

  function onPicked() {
    // 选完了就不在选文件流程里了。手机端那条路靠回前台落它，这一句是给桌面端的——
    // 弹框不会让页面隐藏，没有回前台那个边沿（见 [picking]）
    picking = false;
    // **先拷出来**：`input.files` 是活引用不是快照，下一行清 value 会把它就地清空，
    // 拿着它去判 length 永远是 0
    var files = Array.prototype.slice.call(pickFiles.files);
    // 清空才能第二次选同一批文件——不清的话 value 没变，change 根本不触发
    pickFiles.value = '';
    if (!files.length) return;

    // **这里不 [render.open]**：接下来 `queue.add` 会立刻进等 config 那一段，而列表还空着的
    // 那一屏画的是空态版式——设备那块要留在屏上（稿 11631:35384）。露批次面板的时机挪到
    // [onChange]，列表定型之后
    if (!batch) {
      // `onSuspect`：上传连着几条没收到响应时 queue 会叫一声，接到 [kick] —— 立刻探一拍，
      // 不等那个 5 s 的定时器。**它只是催查，不是结论**：断没断仍由心跳按 [LOST_AFTER_BEATS]
      // 判，那是本页唯一有资格下这个结论的地方
      batch = queue.create({ onChange: onChange, onOccupied: onOccupied, onSuspect: kick });
    }
    queue.add(batch, files, pickingMore);
  }

  /**
   * 底部那两个按钮。几种语义共用，文案与 data-action 由 render 按状态定。
   *
   * 埋点：Send 与 Retry / Resume 由 queue 在自己的门后报（连点、程序自己重开都不算），这里只递「是用户点的」；
   * Done 没有门，就在这儿报
   */
  function onAction(action) {
    if (!batch) return;
    if (action === 'send') {
      queue.send(batch, true);
    } else if (action === 'retry' || action === 'resume') {
      // 三条路：暂停态接着发还排着队的、暂停态整批重开、结果页把失败的那几条重开成新的一批。
      // 由 queue 按批次状态自己分，`app.js` 不管（见 `queue.retry`）。同一个键按屏上的词分两个埋点
      queue.retry(batch, action);
      // **当场探一拍**：断着网点 Retry 时，多久弹回中断态不该由「这一发 PUT 什么时候报错」
      // 决定——那个时长归系统的连接超时管，同一台机器上几秒到几十秒都有，用户看到的就是
      // 「每次点不一样」。探一拍把判据换成我们自己的 [PING_TIMEOUT_MS]。通着的话只是多一拍心跳
      kick();
    } else if (action === 'stop') {
      // 二次确认（稿 10279:84821）。确认了才停——传到一半被误触停掉是很贵的
      render.confirm('stopTransfer', 'stop', function () {
        queue.stop(batch);
      });
    } else if (action === 'done') {
      // 这一批到此为止，回空态。想接着传就重新选文件——协议上一个 batch_id 只能用一次。
      // 「中断态的 Done 要叫手机端别再等剩下的」是批次生命周期的规则，归 queue.finish——
      // 要不要打、什么时候不能打，见它的 KDoc
      api.event('click_sender_done', batch.batchId);
      queue.finish(batch);
      batch = null;
      render.reset();
    }
  }

  // ---------------------------------------------------------------------------
  // 启动
  // ---------------------------------------------------------------------------

  function start() {
    pickFiles = document.getElementById('pick-files');
    pickFiles.addEventListener('change', onPicked);
    // 桌面弹框点取消：没有 change、页面也没隐藏过，[picking] 会一直举着，之后第一次切标签页
    // 白蹭一次宽限。两道都接上——老浏览器不发 `cancel`，但弹框一关窗口就重新拿到焦点。
    // 手机那条路隐藏过，回前台那一句先清，这两道落上去也只是重复赋值
    pickFiles.addEventListener('cancel', function () { picking = false; });
    window.addEventListener('focus', function () { picking = false; });

    render.mount({
      // 举起来：从这一刻到回前台之间的隐藏都算去选文件，要报 `away`（见 [picking]）
      add: function (more) {
        picking = true;
        pickingMore = !!more;
        api.event(more ? 'click_add_more_files' : 'click_select_file', batch && batch.batchId);
        pickFiles.click();
      },
      remove: function (uid) { queue.remove(batch, uid); },
      dismiss: function () { queue.dismissDialog(batch); },
      action: onAction
    });

    render.link(link);
    // 先抢身份再开心跳。抢不到就是本浏览器另有一页开着，画占用屏等它关掉（D16）
    api.claimSender(
      function () {
        // 网卡的两个信号只有开工的这页要听：没抢到身份的那页没有心跳可催，听了 online 就把锁
        // 绕过去，听了 offline 则会盖掉占用屏、之后又没有心跳把它切回来
        // 网卡断了浏览器直接给信号，不用等 3 拍 24 秒（§2.4）。**隐藏时不听**：Android 切应用
        // 本身就会抖这个事件，而它是唯一跳过那 3 拍宽限的入口
        window.addEventListener('offline', function () {
          if (!document.hidden) setLink('offline');
        });
        // 网卡回来不等于连得上手机：先探一拍，探通了心跳自己会切回 ok
        window.addEventListener('online', function () {
          clearMissed();
          kick();
        });
        // 页面隐藏 = 定时器要被限流、久了整页冻结，而去系统文件选择器挑文件正是一次隐藏
        document.addEventListener('visibilitychange', onVisibility);
        beat();
      },
      // 没抢到身份的这一页不发心跳，走不到 [beat] 里那几档上报，在这儿报
      function () {
        connectFailed('duplicate_page');
        setLink('busy');
      }
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();

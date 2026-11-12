// 把 queue.js 的 batch 画到页面上。这一层不发任何请求，也不改 batch 里的任何字段。
//
// 版式照 Figma 稿（node 10279:83779 攒批态）：卡片 = info 条 + 分隔线 + 可滚动列表 + 底部按钮。
// 列表第一行固定是「Add more files」，其余每行是 48px 封面 + 文件名 + 移除。
//
// 一批最多 2000 条，而 onChange 在每个 progress 事件都会来（§7：500–2000 个小文件是要支持的
// 场景）。所以：行只建一次，刷新按帧合并，每次刷新只碰真的变了的那几行。
(function () {
  var LP = window.LP;
  var STATE = LP.queue.STATE;
  var BATCH = LP.queue.BATCH;
  var REASON = LP.queue.REASON;
  var isLinkCause = LP.queue.isLinkCause;

  var els = null;
  var rows = null;
  var frame = 0;
  var queued = null;
  var handlers = null;
  /** 上一次画出来的行顺序，用来判断要不要重排 DOM */
  var lastOrder = [];
  var holdTimer = 0;

  /**
   * 完成的条目在列表里多留多久。取自端内云盘备份重建列表那条路的防抖时长
   * （`CloudUploadOrDownloadViewModel.onTaskUpdate` 的 `postDelayed(updateRunnable, 200)`）。
   */
  var DONE_HOLD_MS = 200;

  /**
   * 离场动画时长，与 app.css 里 `.row-leaving` 的过渡对齐——**两处要一起改**。
   * 取端内 RecyclerView `DefaultItemAnimator` 的移除档（淡出 120 ms、其余行上移 250 ms），
   * 这里合成一条过渡：这一行的高度收到 0，下面的行就跟着平移上来。
   */
  var LEAVE_MS = 250;

  /** 上一帧画头部/底部用的签名（见 [flush] 尾部）。reset 时清掉，保证下一批第一次必重画 */
  var headerSig = null;

  /**
   * 当前连接状态，由 [link] 记下（`ok` / `unknown` / `busy` / `lost` / `offline`）。
   *
   * **中断态底部那块要的「现在断没断」在这里，不在批次上**：断连是页面级的一层，盖在
   * `batch.pauseCause` 之上，由它现推——`view` 的 PAUSED 分支断着网就说 5.3 / 5.4，
   * 网一回来自己落回这一批真正的原因（`user` / `no_space`），queue 不用备份再还原。
   *
   * **页面级、不随批次重置**：[reset] 清的是批次那一块，连接状态照旧由心跳说了算。
   */
  var linkState = 'ok';

  /** 还顶着开机那一屏没有（稿 11631:35384）。HTML 出厂就是转圈，首拍出结论才换过来，见 [link] */
  var booting = true;

  // ---------------------------------------------------------------------------
  // 文案
  // ---------------------------------------------------------------------------

  /** 取不到就回 key 本身：strings.xml 漏了一条时页面上看得见是哪条，不会是 undefined */
  function t(key) {
    var table = LP.i18n || {};
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : key;
  }

  /**
   * Android 的格式位。位置式（`%1$s`）与顺序式（`%d`）都认——文案文档两种都在用。
   */
  function format(template, args) {
    var seq = 0;
    return template.replace(/%(?:(\d+)\$)?([sd])/g, function (whole, index) {
      var value = index ? args[Number(index) - 1] : args[seq++];
      return value === undefined ? whole : String(value);
    });
  }

  /**
   * 复数。服务端注入时不知道数量，所以 one / other 两种形式都注了，这里按 n 选
   * （见 `WebI18n.PLURALS`）。
   */
  function plural(key, n) {
    return format(t(n === 1 ? key + 'One' : key + 'Other'), [n]);
  }

  function percent(sent, size) {
    if (size <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((sent / size) * 100)));
  }

  // ---------------------------------------------------------------------------
  // 行
  // ---------------------------------------------------------------------------

  function element(tag, className, parent) {
    var node = document.createElement(tag);
    node.className = className;
    if (parent) parent.appendChild(node);
    return node;
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /** r = 9 的周长，dashoffset 按它算 */
  var RING_LENGTH = 2 * Math.PI * 9;

  /**
   * 排队态照稿子 ic_Loading 画 3/4 圈，**用 dash 图案画，不碰 dashoffset**——那条通道是进度的
   * （[ringFraction]）。借来表达「在排队」的话，轮到这一条开传就是一次 0.75 → 0 的值变化，
   * 会被 app.css 里 uploading 态那条过渡演成 0.2 s 的倒退：用户看到的是排着的那条明明显示
   * 「已经 3/4」，一开传反而掉回去，紧接着上一条才打钩。
   *
   * 排队时 dashoffset 正好是一整个周期、等价于 0，所以 3/4 弧照样从 12 点起画；dasharray 不在
   * 过渡里，切过去是瞬时的。
   */
  var QUEUED_DASH = RING_LENGTH * 0.75 + ' ' + RING_LENGTH * 0.25;

  /**
   * 稿子里 `ic_progress_stopped` 那条 path，原样搬进来（Figma node 10389:24610）。
   * 不单独存成 svg 贴 `<img>`：它得跟进度环在同一个 svg 里按 `data-state` 切换，
   * 每行再挂一个图片标签，2000 行就是 2000 个多余节点。
   */
  var STOP_PATH = 'M12.0002 14.9355C12.8286 14.9355 13.5002 15.6071 13.5002 16.4355C13.5002 ' +
    '17.264 12.8286 17.9355 12.0002 17.9355C11.1718 17.9355 10.5002 17.2639 10.5002 16.4355C' +
    '10.5002 15.6071 11.1718 14.9356 12.0002 14.9355ZM12.0002 5.93555C12.4768 5.93555 12.9315 ' +
    '6.14235 13.2453 6.50098C13.5651 6.8664 13.7099 7.35545 13.6398 7.83594L12.8586 13.1934C' +
    '12.7964 13.6195 12.4308 13.9355 12.0002 13.9355C11.5696 13.9355 11.2039 13.6195 11.1418 ' +
    '13.1934L10.3605 7.83594C10.2905 7.35545 10.4353 6.8664 10.7551 6.50098C11.0689 6.14233 ' +
    '11.5236 5.93556 12.0002 5.93555Z';

  /**
   * 条目尾部的进度环。稿子给的两个图标是同一个组件的两态，所以这里按进度画弧，
   * 不贴静态图——静态图给不出单条进度。
   */
  function svgRing() {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'row-ring');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');

    function circle(className) {
      var node = document.createElementNS(SVG_NS, 'circle');
      node.setAttribute('class', className);
      node.setAttribute('cx', '12');
      node.setAttribute('cy', '12');
      node.setAttribute('r', '9');
      svg.appendChild(node);
      return node;
    }

    circle('ring-track');
    var arc = circle('ring-arc');
    arc.setAttribute('stroke-dasharray', String(RING_LENGTH));

    // 完成那一下的对钩，对应端内的 progress_finish_*.lottie
    var check = document.createElementNS(SVG_NS, 'path');
    check.setAttribute('class', 'ring-check');
    check.setAttribute('d', 'M7 12.4 L10.4 15.8 L17 9.2');
    svg.appendChild(check);

    // 失败那条的叹号（稿子的 ic_progress_stopped）。它的 viewBox 恰好也是 24，路径原样搬
    var stop = document.createElementNS(SVG_NS, 'path');
    stop.setAttribute('class', 'ring-stop');
    stop.setAttribute('d', STOP_PATH);
    svg.appendChild(stop);

    return {
      svg: svg,
      set: function (fraction) {
        arc.setAttribute('stroke-dashoffset', String(RING_LENGTH * (1 - fraction)));
      },
      /** 排队态换 [QUEUED_DASH] 图案，其余状态整圈一段 */
      queued: function (on) {
        arc.setAttribute('stroke-dasharray', on ? QUEUED_DASH : String(RING_LENGTH));
      }
    };
  }

  /**
   * 进度环画到几成。**这条通道只表达进度**——排队态那 3/4 圈不走这里，由 [QUEUED_DASH] 的
   * dash 图案画（原因在它那儿）。
   */
  function ringFraction(item) {
    if (item.state === STATE.UPLOADING) return percent(item.sent, item.size) / 100;
    // 排队与开传的起点都是 0：这一档值不变，轮到它开传时才不会触发那条过渡。中断的条目也在
    // 这一档（它仍是 `queued`）——环整个被叹号顶掉，画多少都看不见，跟着排队一起给 0
    if (item.state === STATE.QUEUED) return 0;
    // processing / saved / failed 都已经不在传了，画满
    return 1;
  }

  function image(src, className, parent) {
    var node = element('img', className, parent);
    node.src = src;
    node.alt = '';
    return node;
  }

  /** 列表第一行：再加一批文件进当前这批 */
  function createAddRow() {
    var li = element('li', 'row row-add');
    var tile = element('div', 'row-cover cover-add', li);
    image('/assets/img/ic-add.svg', 'cover-icon', tile);
    var name = element('span', 'row-name row-name-add', li);
    name.textContent = t('addMoreFiles');
    // 传 true：埋点分「Add more files」与空态那个入口（`click_add_more_files` / `click_select_file`）
    li.addEventListener('click', function () { handlers.add(true); });
    return li;
  }

  function createRow(item) {
    var li = element('li', 'row');

    var cover = element('div', 'row-cover', li);
    var coverIcon = image('', '', cover);

    var name = element('span', 'row-name', li);

    var remove = element('button', 'row-remove', li);
    remove.type = 'button';
    image('/assets/img/ic-remove.svg', 'row-remove-icon', remove);
    remove.addEventListener('click', function () { handlers.remove(item.uid); });

    var ring = svgRing();
    li.appendChild(ring.svg);

    return {
      /** 行的 item 序号。摘行那趟按 lastOrder 走（见 [flush]），行对象上得存一份才不用每帧 Object.keys */
      uid: item.uid,
      li: li,
      cover: cover,
      coverIcon: coverIcon,
      name: name,
      remove: remove,
      ring: ring,
      lastState: null,
      lastSent: -1,
      lastName: null,
      lastKind: undefined,
      lastInterrupted: false,
      lastCollecting: undefined
    };
  }

  /**
   * 音频与歌词的封面不同：音频是整块音符图，歌词是另一个底色 + 居中的歌词图标。
   *
   * **得能改**：`kind` 要等 `GET /api/config` 回来才定得下来，而列表在那之前就画出去了
   * （不让用户干等一次往返）。建行时画错、配置到了再换，比压着列表不画强。
   */
  function paintCover(row, kind) {
    if (row.lastKind === kind) return;
    row.lastKind = kind;

    var lyrics = kind === 'lyrics';
    row.cover.className = lyrics ? 'row-cover cover-lyrics' : 'row-cover';
    row.coverIcon.className = lyrics ? 'cover-icon' : 'cover-full';
    row.coverIcon.src = lyrics ? '/assets/img/ic-lyrics.svg' : '/assets/img/cover-song.svg';
  }

  function updateRow(row, item, collecting) {
    // collecting 是**批次级**的，得一起比：从攒批切到传输时条目状态往往没变，
    // 只比条目字段的话这些行会停在旧样子——移除按钮留着、进度环不出来
    //
    // `interrupted` 同样得比：中断的条目 state 仍是 `queued`（见 `queue.interrupt`），
    // 只比 state 的话「传到一半被打断」这一下根本不触发重绘，叹号出不来
    if (row.lastState === item.state && row.lastSent === item.sent &&
        row.lastName === item.name && row.lastKind === item.kind &&
        row.lastInterrupted === item.interrupted &&
        row.lastCollecting === collecting) {
      return;
    }
    row.lastCollecting = collecting;
    paintCover(row, item.kind);

    if (row.lastName !== item.name) {
      // textContent 不是 innerHTML：文件名是用户机器上来的，不当标记解析
      row.name.textContent = item.name;
      row.lastName = item.name;
    }

    if (row.lastState !== item.state) {
      row.li.setAttribute('data-state', item.state);
      row.ring.queued(item.state === STATE.QUEUED);
      row.lastState = item.state;
    }
    // 产品态「发送中断」。**单独一个属性、不挤进 `data-state`**：它与 `queued` 正交，
    // 变的只有行尾画什么，理由见 `queue.interrupt`
    if (row.lastInterrupted !== item.interrupted) {
      if (item.interrupted) row.li.setAttribute('data-interrupted', '');
      else row.li.removeAttribute('data-interrupted');
      row.lastInterrupted = item.interrupted;
    }
    // 移除只在发送前有意义，开传之后协议上就收不回来了；那会儿右边换成进度环
    row.remove.hidden = !collecting;
    // 进度环是 SVG，**不能写 .hidden**：这个 IDL 属性在 HTMLElement 上，SVGElement 没有，
    // 赋值只是挂了个同名的普通属性，内容属性没变、元素照常显示。得直接改属性
    if (collecting) row.ring.svg.setAttribute('hidden', '');
    else row.ring.svg.removeAttribute('hidden');

    row.ring.set(ringFraction(item));
    row.lastSent = item.sent;
  }

  /** 把一行从 DOM 与行表里一并摘掉，不留动画。[reset] 与 [flush] 的首轮转圈用它——批次整个作废了，没什么可淡出的 */
  function removeRow(uid) {
    if (rows[uid].li.parentNode) els.list.removeChild(rows[uid].li);
    delete rows[uid];
  }

  /**
   * 收起几行：淡出 + 把自己的高度收掉，下面的行跟着平移上来，收完再摘。传完的那条打完钩
   * （[DONE_HOLD_MS]）走这里，攒批时被用户移除的也走这里——端内 RecyclerView 两种都有动画。
   *
   * **高度得先钉成实测值**：`auto → 0` 没有可插值的起点，过渡根本不会跑，行还是一下子就没。
   * 钉完要强制一次布局再改 0，否则同一帧里的两次赋值会被样式系统合并成「一直是 0」。
   *
   * **一批一起收、读写分趟**：量高度是读，钉高度是写，再量一次是读，改 0 是写。逐行做的话每行
   * 都在写之后读，k 行离场就把 2000 行的列表强制布局 2k 次；分趟之后不管几行都只布局两次。
   * 流水深度 3 加 [DONE_HOLD_MS] 那 200 ms 的窗口让两三条一起离场是常态。
   *
   * 离场中的行 `rows` 里已经没有了、DOM 上还挂着，靠 `.row-leaving` 认（[keptNext] / [reset]）。
   */
  function leaveRows(uids) {
    var lis = [];
    uids.forEach(function (uid) {
      var li = rows[uid].li;
      delete rows[uid];
      if (li.parentNode) lis.push(li);
    });
    if (!lis.length) return;
    var heights = lis.map(function (li) { return li.getBoundingClientRect().height; });
    lis.forEach(function (li, i) {
      li.style.height = heights[i] + 'px';
      li.classList.add('row-leaving');
    });
    lis[0].getBoundingClientRect();
    lis.forEach(function (li) { li.style.height = '0'; });
    setTimeout(function () {
      lis.forEach(function (li) {
        if (li.parentNode) els.list.removeChild(li);
      });
    }, LEAVE_MS);
  }

  // ---------------------------------------------------------------------------
  // 卡片头尾
  // ---------------------------------------------------------------------------

  /** 保存下来的条目按分类点数，出传完那屏底部的两行 */
  function kindCounts(batch) {
    var out = { audio: 0, lyrics: 0 };
    batch.items.forEach(function (item) {
      if (item.state !== STATE.SAVED) return;
      // kind 为 null 是 config 没取到那一档，归到音频——列表里的封面也是这么退的（paintCover）
      out[item.kind === 'lyrics' ? 'lyrics' : 'audio']++;
    });
    return out;
  }

  /**
   * 中断态底部那块的「标题 + 正文」。
   *
   * **用户自己按停的没有这一块**（稿 10389:20561）：他知道自己干了什么，不需要解释，
   * 所以回 null。出错停的才有（稿 10279:86266 + 10284:90206 / 10284:90214）。
   *
   * **占用不在这儿**：它整页接管、走 [link] 那条路，不是列表底部的一句提示。
   */
  function pauseHint(cause) {
    if (cause === 'user') return null;
    // 本机断网与连不上手机同一句（稿 11070:174877；wifi 那一版 10284:90206 已从稿里删掉）。
    // **两个 cause 不合并**：它们仍要在日志里分得开，用户那头才一句话
    if (cause === 'offline' || cause === 'lost') {
      return { text: t('connectionLost'), sub: t('checkWifi') };
    }
    // 手机端不认这一批（连撞两次 409 `state_conflict`）。链路其实是通的，可 `WebI18n` 里没有
    // 一条对得上的话，先借 5.3 这一对——缺口记在 docs §8.4，文案一到只改这一行
    if (cause === 'conflict') return { text: t('connectionLost'), sub: t('checkWifi') };
    if (cause === 'no_space') return { text: t('notEnoughStorage'), sub: t('freeUpSpaceOnDevice') };
    // **兜底不出提示块，而不是挑一句话圆过去**：`pauseCause` 有五种取值、散在 queue.js 四处写入，
    // 将来再加一种（例如把 429 重试耗尽独立成档）而忘了来这里补臂，说一句与真实原因无关的
    // 「存储不足」既不报错也不崩溃，只会变成一条难查的用户反馈；缺了提示块则在 UI 上一眼可见。
    // 两个调用方都吃得下 null——PAUSED 档的 `if (hint) hint.variant = 'error'` 本就 null-safe，
    // [incompleteView] 只在 `isLinkCause` 为真时调，命中的必是上面 offline / lost 两臂
    return null;
  }

  /** info 条右侧那句状态，与底部按钮的文案／语义 */
  function view(batch, counts) {
    switch (batch.state) {
      // 攒批与预检在飞共用「选完等发」这张版式（稿 11092:175008）：预检回包才定落盘名、才知道
      // 哪些被拒，这会儿列表根本没定型，写「0 files sent」等于提前宣布已经在传了。整屏照旧
      // 攒批的样子——info 条「N files / Ready to send」，Add more files 那行还在，每行右边
      // 仍是移除按钮。列表上那两个入口看着还在，但点了不动——`queue.add` / `queue.remove`
      // 都要求 COLLECTING
      // 等 config 落地那一屏也照攒批的样子画（稿 11631:35879）：info 条与列表都是上一轮
      // 定型后的内容，只有 Send 恒灰、转圈另画。列表还空着时走不到这儿——[flush] 在更早
      // 的地方就整块换成了 11631:35384 那一屏
      case BATCH.FILTERING:
      case BATCH.COLLECTING:
      case BATCH.PREPARING:
        return {
          status: t('readyToSend'),
          action: 'send',
          label: t('send'),
          // 一条可传的都没有时置灰。两种走法都到这儿：本次选的全被本地预过滤拒了，或者用户
          // 把列表逐条移空了。亮着却点不动比灰着更难理解——`send()` 本来就会空转。预检在飞
          // 与等 config 落地都恒灰：前者点下去的反馈交给按钮那个圈，后者整屏都是锁住的
          disabled: batch.state !== BATCH.COLLECTING || counts.pending === 0,
          loading: batch.state === BATCH.PREPARING
        };
      case BATCH.UPLOADING:
        return {
          status: format(t('remaining'), [counts.remaining]),
          action: 'stop',
          label: t('stop'),
          ghost: true,
          hint: { text: t('stayOnPage'), icon: true }
        };
      case BATCH.PAUSED: {
        // 停下来的都是暂停不是失败：条目原样留着，按 Retry 接着发。原因在底部那块说，右上角
        // 照旧是「还剩几条」——稿子 10279:86266 就是这么分工的。`batch/start` 断连那一种一个
        // 字节都没发过，它的 Retry 是重开一批不是续传，由 `queue.retry()` 自己分。
        //
        // **被顶替占用不走这里**：那一档是页面级的独立状态（稿 10657:125615），整页接管、
        // 批次作废，由 `app.js` 接（`BATCH.OCCUPIED`）
        // 断着网就说断连那一对，否则说这一批自己停下来的原因。**合成在这里、不落到批次上**：
        // 用户按 Stop 之后断网，屏幕上该改说「连接断了」，网一回来又该说回「已暂停」——
        // 这是一层盖在上面的显示态，往 `pauseCause` 里写就得再备份一份原值等着还原
        var cause = isLinkCause(linkState) ? linkState : batch.pauseCause;
        var hint = pauseHint(cause);
        if (hint) hint.variant = 'error';
        // 断着网时按钮是 Retry 不是 Resume：这会儿点下去接不上，词也不该说得像能接着来
        var self = cause === 'user';
        return {
          status: format(t('remaining'), [counts.remaining]),
          action: 'done',
          label: t('done'),
          ghost: true,
          retry: true,
          // 自己按停的是「接着来」，出错停的是「再试一次」——稿子用了两个词。埋点按屏上这个词分
          // click_resume / click_sender_retry，所以两个值同出一处，`action` 回给 app.js
          retryLabel: self ? t('resume') : t('retry'),
          retryAction: self ? 'resume' : 'retry',
          hint: hint
        };
      }
      default:
        return incompleteView(batch, counts);
    }
  }

  /**
   * 「跳过」那一行。**已存在与不支持共用一个计数**，只换措辞（稿 10418:26238 仅已存在 /
   * 10884:138124 仅不支持 / 10884:138108 两者都有）——不是各占一行。
   *
   * 三条是互斥的整句而不是可拼接的片段：拼句子在别的语言里排不出来。
   */
  function skippedLine(counts) {
    if (counts.skippedExist && counts.skippedUnsupported) return plural('skippedBoth', counts.skipped);
    if (counts.skippedUnsupported) return plural('skippedUnsupported', counts.skipped);
    return plural('skippedDuplicate', counts.skipped);
  }

  /**
   * 部分完成。**不是大对钩那一屏**——列表留着，没成的条目都还在，右上角换成计数，底部那块说明细。
   *
   * 7 种组合（失败 F / 已存在 D / 不支持 U 的非空子集）共用这一张版式，靠两个开关拼出来：
   * 标题按有没有失败切，正文最多两行（失败一行 + 跳过一行）。见稿 10309:95125（F）、
   * 10418:26046（D）、10884:138124（U）、10437:26427（F+D）、10884:138140（F+U）、
   * 10884:138108（D+U）、10884:138148（F+D+U）。
   *
   * **断连造成的失败在这一屏改说 5.3 / 5.4 那对话**：批次尾部那几条同时断连失败时，`queue`
   * 先把整批置成暂停、紧接着又因为没有待传条目翻成终态（`advance`），中断态那一屏一帧都没
   * 画出来。原因只剩 `pauseCause` 这一份，不读它的话页面会把「链路断了」说成「这几个文件
   * 传不了，请重试」——归错了因，而且网一回来这一屏就再也不会变了。
   *
   * **这里直读 `batch.pauseCause`，与 `view()` 的 PAUSED 分支口径不同是有意的**：那一档说的是
   * 「现在为什么停着」，所以按当前 `linkState` 合成；这一屏说的是「这几条当初为什么没传成」，
   * 是已经落定的历史归因。`linkState` 变化确实会经 `flush()` 的 header signature 触发重绘，
   * 但重绘后措辞照旧——网回来了不改变那几条是断连失败的事实。
   */
  function incompleteView(batch, counts) {
    // 全是跳过的那几档与链路无关，挂一句「连接断了」是错的，所以先要有失败
    var link = counts.failed && isLinkCause(batch.pauseCause) ? pauseHint(batch.pauseCause) : null;
    var lines = [];
    if (counts.failed) lines.push(link ? link.sub : plural('couldntBeSent', counts.failed));
    if (counts.skipped) lines.push(skippedLine(counts));
    return {
      tallies: true,
      action: 'done',
      label: t('done'),
      ghost: true,
      // 有失败才给 Retry（sender_states §6.4）。跳过的两档不给——`duplicate` 再传还是重复，
      // `unsupported` 再传还是收不了。点下去是把失败的那几条重开成新的一批（`queue.retry`）
      retry: counts.failed > 0,
      hint: {
        text: link ? link.text : (counts.failed ? t('transferIncomplete') : t('transferComplete')),
        sub: lines.join('\n'),
        // 断连档也留 result：这是结果页的版式，换成 error 只会把标题字号改小
        variant: 'result'
      }
    };
  }

  /** 当前可见区顶部那一行，重排后拿它把滚动位置钉回去 */
  function firstVisibleRow() {
    var top = els.list.scrollTop;
    for (var i = 0; i < lastOrder.length; i++) {
      var row = lastOrder[i];
      if (row.li.parentNode && row.li.offsetTop + row.li.offsetHeight > top) return row;
    }
    return null;
  }

  /**
   * **跳过与失败的沉底（[flush] 里的 `sunk`），其余不按状态重排**：顺序就是 `queue` 表序——
   * 最新加的一组在表头，组内保持用户选的顺序，而表序同时就是发送顺序。沉底的判据是「这一批
   * 里它不会再动了」，所以中断的条目留在原位——它们是 `queued`，Resume 就第一个重发。
   *
   * **不能写成「往末尾 append」**：攒批态删掉前面的同名条目后，被判重复而隐藏的那条会重新
   * 放行、插在列表中间（`createRow` 不挂 DOM，这里是唯一挂载点）。
   *
   * **变动前后要钉住滚动位置**，不然条目消失会让用户正看的那行往上跳（端内云盘同样处理）。
   * 只在挂新行时量——`firstVisibleRow` 的 `offsetTop` 会强制同步布局，而删行帧里 `removeChild`
   * 已先于测量发生、delta 恒为 0；沉底帧是纯重排，同样不钉（只在预检回来那一刻发生，列表还在
   * 顶上）。真要给它钉，得先让 [firstVisibleRow] 跳过 `.row-leaving`，否则会拿正在收高的行当
   * 锚点算歪。
   */
  /**
   * 下一个**留下来的**兄弟节点。离场中的行还挂在 DOM 上，拿 `nextSibling` 直接比会把它上面
   * 那行判成「位置不对」，重排再把这个正在淡出的行挤走——表现是幽灵跳一格。
   */
  function keptNext(li) {
    var node = li.nextSibling;
    while (node && node.classList && node.classList.contains('row-leaving')) {
      node = node.nextSibling;
    }
    return node;
  }

  function reorder(target) {
    var changed = target.length !== lastOrder.length;
    var mounting = false;
    var i;
    for (i = 0; i < target.length; i++) {
      if (!target[i].li.parentNode) mounting = true;
      if (!changed && target[i] !== lastOrder[i]) changed = true;
    }
    if (!changed) return;

    // 新行挂在**表头** = 用户刚加了一批文件（`queue.collect` 把新的一组插在最前）。这一下要露出
    // 来的正是它们，所以不钉位而是回到顶部——钉位会把新行连同滚动条一起推到可视区上方，用户
    // 看到的和没加一样，那正是「新添加的沉底」这个 bug 换个方向重演
    var toTop = target.length > 0 && !target[0].li.parentNode;
    var anchor = mounting && !toTop ? firstVisibleRow() : null;
    var before = anchor ? anchor.li.offsetTop : 0;
    // 倒着走：`next` 是这一行应该紧挨着的下一个节点，对得上就什么都不做
    var next = null;
    for (i = target.length - 1; i >= 0; i--) {
      var li = target[i].li;
      if (keptNext(li) !== next || !li.parentNode) els.list.insertBefore(li, next);
      next = li;
    }
    lastOrder = target;
    if (toTop) {
      els.list.scrollTop = 0;
    } else if (anchor && anchor.li.parentNode) {
      els.list.scrollTop += anchor.li.offsetTop - before;
    }
  }

  /**
   * 全部成功那屏（node 10292:93076）。**只画全成的情况**——有失败或跳过时走的是
   * [incompleteView]，那是另一张稿、连版式都不一样。
   */
  function flushDone(batch) {
    var kinds = kindCounts(batch);
    els.doneTitle.textContent = t('successfullySent');

    // 一条都没成的那类不占一行，跟着它的分隔线也得收掉
    els.sumMusic.hidden = !kinds.audio;
    els.sumMusicCount.textContent = kinds.audio;
    els.sumLyrics.hidden = !kinds.lyrics;
    els.sumLyricsCount.textContent = kinds.lyrics;
    els.sumDivider.hidden = !(kinds.audio && kinds.lyrics);
  }

  function flush(batch) {
    // **列表还空着时整块换成转圈那一屏**（稿 11631:35384）：这一轮选的文件还在 queue 的
    // `staging` 里，没有任何可画的行。
    //
    // picker / filtering / batch / done 是 `<main>` 下的**同级 section**，每一帧都得把每一块
    // 定死——漏掉一块的表现是两屏同屏，而且只在那个窗口里看得见（`e874f16c6e` 栽过一次）。
    // **设备那块不在这里碰**：首次选文件时还没 [open] 过，它留在屏上正是稿 11631:35384 的
    // 样子；结果页点 Retry 进来时它已经收着，也该维持原样。它的归属只有 [open] / [close]
    // **长度就够**：本地预过滤拒掉的已经在 `queue.refilter` 里丢出 `items` 了，表里每一条都画得
    // 出来。`c113679aed` 当初改判「可见条目」是因为那些条目留在表里、首次全被拒时长度非零而
    // 列表是空的（第二次选文件会落进追加版式，该出的整屏转圈不出来）——那个前提现在没有了
    var firstRound = batch.state === BATCH.FILTERING && batch.items.length === 0;
    els.filtering.hidden = !firstRound;
    if (firstRound) {
      els.picker.hidden = true;
      els.batch.hidden = true;
      els.done.hidden = true;
      // 表空了，上一批的行没有留下的理由。结果页点 Retry 走到这儿时 `rows` 里还是那一批的失败
      // 与跳过条目（Retry 不经过 [reset]），不清的话转圈过后它们会整表一起做离场动画
      Object.keys(rows).forEach(function (uid) { removeRow(uid); });
      lastOrder = [];
      return;
    }

    // 计数不再单独跑一趟（原来是独立的 tally）：行遍历本来就要逐条过，顺手攒。progress 帧
    // 一秒几十次，每帧省一趟 O(n)
    var counts = {
      saved: 0, failed: 0, pending: 0,
      /** 跳过的总数。**已存在与不支持共用这一个计数**，底部那行只换措辞（§6.3） */
      skipped: 0,
      skippedExist: 0,
      skippedUnsupported: 0
    };

    // 「列表还是攒批那副样子」——每行右边是移除按钮而不是进度环。预检态与等 config 那一段
    // 照稿也是这副样子，区别只在按钮，以及 Add more files 那行在不在（见下面的 filtering）
    var collecting = batch.state === BATCH.COLLECTING || batch.state === BATCH.PREPARING ||
      batch.state === BATCH.FILTERING;
    // 已经开传过的：计数说「已发 N」而不是「共 N 条」，成功的条目也从列表里摘掉。
    // **预检态不算**：那会儿一个字节都没发，右上角照旧是「共 N 条」（稿 11092:175008）
    var started = batch.state === BATCH.UPLOADING || batch.state === BATCH.PAUSED ||
      batch.state === BATCH.DONE;
    // 正在发。只有这一档的 `network` 失败还等着裁决、不该沉底（见下面的 `undecided`）
    var uploading = batch.state === BATCH.UPLOADING;
    var now = Date.now();
    var holding = false;

    var order = [];
    /** 跳过的条目：**不按表序排，一律沉到末尾**（稿 10437:26427 里那两条就在最后）。组内保持表序 */
    var sunk = [];
    var seen = Object.create(null);
    batch.items.forEach(function (item) {
      // —— 计数（判据与原来的 tally 逐字相同，只是搬进了这一趟）——
      // 这里的 SKIPPED **只会是预检拒掉的**（带 `item_id`）：计数进「跳过」档，行也留在列表里、
      // 右边不带任何图标。本地预过滤拒掉的根本进不到这儿（`queue.refilter` 当场丢掉），稿子里
      // 它们只以「N files couldn't be added」那个弹窗出现一次
      if (item.state === STATE.SKIPPED) {
        counts.skipped++;
        // 只有「已存在」进 D 那一档，其余一律进「不支持」——预检在产品上只回 duplicate，
        // 别的都是接收端入库时判定收不了的（§6.5）
        if (item.reason === REASON.DUPLICATE) counts.skippedExist++;
        else counts.skippedUnsupported++;
      } else if (item.state === STATE.SAVED) {
        counts.saved++;
      } else if (item.state === STATE.FAILED) {
        counts.failed++;
      } else {
        counts.pending++;
      }

      // —— 行 ——
      // **传输中只摘已完成的，失败的沉底留着**——口径取自端内云盘备份：
      // `list.filter { it.task?.isComplete() != true }`，errorList 仍然拼进结果、排在最末。
      // 已发送数由头部的「N files sent」表达，不必在列表里重复占位。
      //
      // **不是立刻摘**：端内那条完成的会先在原地打钩，因为重建列表的那条路被防抖了 200 ms
      // （`CloudUploadOrDownloadViewModel.onTaskUpdate`），而单条状态是 dispatcher 直接推给
      // ViewHolder 的、立即生效。这里用同一个 200 ms 把那段「先打钩再消失」还原出来
      if (started && item.state === STATE.SAVED) {
        if (now - item.completedAt >= DONE_HOLD_MS) return;
        holding = true;
      }

      var row = rows[item.uid];
      if (!row) {
        row = createRow(item);
        rows[item.uid] = row;
      }
      seen[item.uid] = true;
      updateRow(row, item, collecting);
      // 沉底的两档：手机端拒收的（[STATE.SKIPPED]）与真发送失败的。判据是「这一批里它不会再
      // 动了」——中断的条目不在其中，它们是 `queued`，Resume 就第一个重发（见 `queue.interrupt`）。
      //
      // **等心跳裁决的 `network` 失败也不沉**：断连时每条都秒回失败，挨个沉底看着像「发一条
      // 挂一条」，而裁决一下来 `queue.halt` 就把它们收成中断态、原地回来。只在发送中这么让
      // ——批次停了或收尾了，没等到裁决的就是真失败，照沉
      var undecided = item.netFailed && uploading;
      var done = !undecided && (item.state === STATE.SKIPPED || item.state === STATE.FAILED);
      (done ? sunk : order).push(row);
    });
    order = order.concat(sunk);

    // 「剩余」= 表里所有的减去已发送的，所以失败与跳过的也算在内——它们的行还摆在列表上，
    // 不算的话「已发 + 剩余」凑不齐列表行数（稿 10279:86266 的 60 + 40 正好是 100）。
    //
    // **写成减法不是 pending + failed + skipped**：那种写法在 [STATE] 新增一档时会静默少算，
    // 而减法只依赖「已发送」这一个定义
    counts.remaining = batch.items.length - counts.saved;

    // **全成才换整屏**。有失败或跳过时列表要留着（稿 10437:26427）
    var perfect = batch.state === BATCH.DONE &&
      counts.failed === 0 && counts.skipped === 0;
    els.batch.hidden = perfect;
    els.done.hidden = !perfect;
    if (perfect) {
      flushDone(batch);
      return;
    }

    // 被移除或已完成的行要跟着消失。按上一帧的 order 走而不是 `Object.keys(rows)`：行只在
    // 上面那趟里建、建了必进 order，键集与行集恒等，这样每帧少滤一个键数组
    var i;
    var gone = [];
    for (i = 0; i < lastOrder.length; i++) {
      if (!seen[lastOrder[i].uid]) gone.push(lastOrder[i].uid);
    }
    leaveRows(gone);

    reorder(order);

    // 打钩窗口还没过，安排一次补刷——否则这条会一直停在列表里等下一个事件
    if (holding && !holdTimer) {
      holdTimer = setTimeout(function () {
        holdTimer = 0;
        show(queued);
      }, DONE_HOLD_MS);
    }

    // 头部与底部各槽由（状态、计数、暂停原因、拒收弹窗数）完全决定，而这些值整场传输几乎
    // 不变——progress 帧一秒几十次，帧与帧之间只有某一条的进度在动。签名对上就整块跳过，
    // 一帧只碰真的在动的那一行。**往这块加新输出时把它的来源加进签名**，否则帧间不会重画。
    //
    // **表长单独钉一份**：它是 `remaining` 与 `els.count` 那两处的共同源头。眼下四个计数之和恒
    // 等于表长、钉不钉一样，但 [STATE] 新增一档时恒等式就没了——那正是 `remaining` 写成减法要
    // 防的场景，不钉就成了「防住少算、防不住不重绘」
    var sig = batch.state + '|' + counts.saved + ',' + counts.failed + ',' + counts.pending +
      ',' + counts.skipped + ',' + batch.items.length +
      ',' + (batch.rejectedNotice || 0) + '|' + (batch.pauseCause || '') +
      '|' + linkState + '|' + (batch.sendBlocked || '');
    if (headerSig === sig) return;
    headerSig = sig;

    var shape = view(batch, counts);

    // 攒批阶段才给「Add more files」那一行（挪进签名块：它只由状态决定，帧间不变）。
    // 等 config 那一段整屏锁住，这一行跟着收起来——不然点进去会撞 [queue.add] 那道
    // `state !== COLLECTING` 的门，看着能点、点了不动
    els.addRow.hidden = !collecting || batch.state === BATCH.FILTERING;

    // 追加选文件时的转圈（稿 11631:35879），夹在 info 条与列表之间。`data-phase` 同时让
    // CSS 把行上的移除按钮锁住
    els.listSpin.hidden = batch.state !== BATCH.FILTERING;

    els.batch.setAttribute('data-phase', batch.state);

    // 那个 ✓ 只在停下来之后出现：传输中那屏（10252:76598）的 info 条左边是光秃秃的计数
    els.infoIcon.hidden = batch.state !== BATCH.PAUSED && batch.state !== BATCH.DONE;
    els.count.textContent = started
      ? plural('filesSent', counts.saved)
      // 直接用表长：这一档一行都不摘（上面那个早退带着 `started`），数字要和列表行数对得上。
      // 逐档相加会漏掉跳过的——`batch/start` 撞 413 退回这一屏时它们还留在列表里
      : plural('files', batch.items.length);

    els.status.hidden = !!shape.tallies;
    els.tallies.hidden = !shape.tallies;
    if (shape.tallies) {
      els.failed.hidden = !counts.failed;
      els.failed.textContent = format(t('failedCount'), [counts.failed]);
      els.skipped.hidden = !counts.skipped;
      els.skipped.textContent = format(t('skippedCount'), [counts.skipped]);
      // 只有一类时那个点没有东西可分隔
      els.dot.hidden = !(counts.failed && counts.skipped);
    } else {
      els.status.textContent = shape.status;
    }

    els.hint.hidden = !shape.hint;
    if (shape.hint) {
      els.hint.className = shape.hint.variant ? 'hint hint-' + shape.hint.variant : 'hint';
      els.hintIcon.hidden = !shape.hint.icon;
      els.hintText.textContent = shape.hint.text;
      els.hintSub.textContent = shape.hint.sub || '';
      els.hintSub.hidden = !shape.hint.sub;
    }
    // 提示绝对定位压在列表上，不让出这块高度，滚到底时最后一行就落在它下面出不来。
    // 现量不写死：高度随档位与文案换行变。留在签名块里——`offsetHeight` 强制布局，逐帧付不起
    syncHintPad();

    els.action.hidden = !shape.action;
    if (shape.action) {
      els.action.textContent = shape.label;
      els.action.setAttribute('data-action', shape.action);
      els.action.className = 'btn-wide' + (shape.ghost ? ' btn-wide-ghost' : '') +
        (shape.loading ? ' btn-wide-loading' : '');
      els.action.disabled = !!shape.disabled;
    }
    els.retry.hidden = !shape.retry;
    if (shape.retry) {
      els.retry.textContent = shape.retryLabel || t('retry');
      els.retry.setAttribute('data-action', shape.retryAction || 'retry');
    }


    // 确认框开着时不碰弹窗：两处共用同一块 DOM，按帧刷新会把它顶掉
    if (confirming) return;
    // 两种提示同版式（标题 + 正文 + 单 OK），断连那档优先——它是用户刚按下 Send 的直接回答
    var blocked = batch.sendBlocked;
    var rejected = batch.rejectedNotice || 0;
    els.dialog.hidden = !blocked && rejected <= 0;
    if (blocked || rejected > 0) {
      // 与空态 2.3/2.4、中断态 5.3/5.4 同一对文案：同一件事，只是发生在哪一步不同
      var hint = blocked ? pauseHint(blocked) : null;
      els.dialogTitle.textContent = hint ? hint.text : plural('couldntBeAdded', rejected);
      els.dialogBody.textContent = hint ? hint.sub : t('rules');
      els.dialogBody.hidden = false;
      els.dialogCancel.hidden = true;
      els.dialogOk.textContent = t('ok');
    }
  }

  // ---------------------------------------------------------------------------
  // 二次确认
  // ---------------------------------------------------------------------------

  /** 确认框开着没有。开着时 [flush] 不碰弹窗那块 DOM——两处共用同一个 */
  var confirming = false;
  var onConfirm = null;

  /**
   * 二次确认（稿 10279:84821）：只有标题，两个文字按钮。与「加不进来的文件」那个弹窗
   * 共用一块 DOM——版式一样，差别只是有没有正文、有没有取消键。
   *
   * 标题与确认键收 i18n **key** 而不是查好的文案——调用方不该为这一个口子摸到 `t`
   */
  function confirm(titleKey, okKey, done) {
    confirming = true;
    onConfirm = done;
    els.dialogTitle.textContent = t(titleKey);
    els.dialogBody.hidden = true;
    els.dialogCancel.hidden = false;
    els.dialogCancel.textContent = t('cancel');
    els.dialogOk.textContent = t(okKey);
    els.dialog.hidden = false;
  }

  function closeConfirm(ok) {
    confirming = false;
    els.dialog.hidden = true;
    els.dialogBody.hidden = false;
    els.dialogCancel.hidden = true;
    var done = onConfirm;
    onConfirm = null;
    if (ok && done) done();
  }

  // ---------------------------------------------------------------------------
  // 对外
  // ---------------------------------------------------------------------------

  function byId(id) {
    return document.getElementById(id);
  }

  /**
   * 列表底部留白对齐 `.hint` 的实测高度（它绝对定位，不让出高度）。**只看 DOM 现状不接 shape**：
   * resize 那条路上没有 shape，两处共用一份判据
   */
  function syncHintPad() {
    els.list.style.paddingBottom = els.hint.hidden ? '' : els.hint.offsetHeight + 'px';
  }

  /**
   * 宽度一变 `.hint` 的换行数就变，而 [show] 的签名里没有宽度这一维，带 hint 的两档
   * （PAUSED / DONE）又是不再产生 queue 事件的静默态——不听 resize 的话留白停在旧值，
   * 变窄了压住最后一行。**rAF 合流**：`offsetHeight` 每次都强制布局
   */
  var padFrame = 0;

  function onResize() {
    if (padFrame) return;
    padFrame = requestAnimationFrame(function () {
      padFrame = 0;
      syncHintPad();
    });
  }

  function mount(callbacks) {
    handlers = callbacks;
    els = {
      device: byId('device'),
      deviceIcon: byId('device-icon'),
      deviceDown: byId('device-icon-down'),
      deviceBlocked: byId('device-blocked'),
      deviceName: byId('device-name'),
      deviceError: byId('device-error'),
      deviceErrorTitle: byId('device-error-title'),
      deviceErrorBody: byId('device-error-body'),
      picker: byId('picker'),
      filtering: byId('filtering'),
      listSpin: byId('list-spin'),
      pick: byId('btn-pick'),
      pageTitle: byId('page-title'),
      pageSubtitle: byId('page-subtitle'),
      batch: byId('batch'),
      count: byId('batch-count'),
      status: byId('batch-status'),
      list: byId('items'),
      infoIcon: byId('info-icon'),
      tallies: byId('info-counts'),
      failed: byId('info-failed'),
      skipped: byId('info-skipped'),
      dot: byId('info-dot'),
      action: byId('btn-action'),
      retry: byId('btn-retry'),
      hint: byId('hint'),
      hintIcon: byId('hint-icon'),
      hintText: byId('hint-text'),
      hintSub: byId('hint-sub'),
      dialog: byId('dialog'),
      dialogTitle: byId('dialog-title'),
      dialogBody: byId('dialog-body'),
      dialogCancel: byId('dialog-cancel'),
      dialogOk: byId('dialog-ok'),
      done: byId('done'),
      doneTitle: byId('done-title'),
      sumMusic: byId('sum-music'),
      sumMusicCount: byId('sum-music-count'),
      sumLyrics: byId('sum-lyrics'),
      sumLyricsCount: byId('sum-lyrics-count'),
      sumDivider: byId('sum-divider'),
      btnDone: byId('btn-done')
    };
    byId('sum-music-label').textContent = t('music');
    byId('sum-lyrics-label').textContent = t('lyrics');
    els.btnDone.textContent = t('done');
    els.btnDone.addEventListener('click', function () { handlers.action('done'); });
    // 稿子里就是光秃秃的设备名，没有前缀句
    els.deviceName.textContent = LP.device;
    els.pageSubtitle.textContent = t('pageSubtitle');
    // **整张卡片都是热区**（稿 10230:61752），不只是中间那个圆。事件只挂卡片这一层——
    // 按钮的 click 会冒泡上来，两处都挂的话点按钮会把文件选择器开两次
    els.picker.addEventListener('click', function () {
      if (els.pick.disabled) return;
      handlers.add(false);
    });

    els.retry.addEventListener('click', function () { handlers.action(els.retry.getAttribute('data-action')); });
    els.dialogOk.addEventListener('click', function () {
      if (confirming) closeConfirm(true); else handlers.dismiss();
    });
    els.dialogCancel.addEventListener('click', function () { closeConfirm(false); });
    // 旋转 / 分屏 / 缩窗都从这儿回来（见 [onResize]）。orientationchange 不另挂，转屏后必有 resize
    window.addEventListener('resize', onResize);
    rows = {};
    els.addRow = createAddRow();
    els.list.appendChild(els.addRow);
    els.action.addEventListener('click', function () {
      handlers.action(els.action.getAttribute('data-action'));
    });
  }

  /**
   * 空态那一屏的七档（§2）。**版式只有一套**，差别在手机里那个图标、插画下面那两行字、
   * 卡片能不能点：
   *
   * - `unknown` 还没打通过：跟 `ok` 长一样，只是入口不可点。**什么都不说**——那会儿还不知道
   *   发生了什么，先弹一句「手机正忙」是造谣
   * - `ok` 占用在手：设备名 + 可点的入口
   * - `busy` 被别的标签页或别的设备占着（D16，稿 10657:125615）
   * - `self` 这台手机自己的浏览器开的（稿 12143:94311）。与 `busy` 只差正文那一行
   * - `dropped` 手机端用户按了 Disconnect 把这一页赶下来（410 `disconnected`）
   * - `lost` 连不上手机，而浏览器自认在线 / `offline` 本机断网 —— **同一屏**（稿 11070:174877）。
   *   两档只在日志里分得开：对用户而言两种都是「连接断了，检查两台设备是不是同一个 WiFi」，
   *   而他多半也分不出自己撞的是哪一种（稿里 wifi 那一版 10284:90206 已删）
   *
   * 后五档共用「设备名让位给标题 + 正文、卡片整块置灰、标题换成 Can't send files」，只有
   * 那两行字与手机里的图标不同（`lost` 与 `offline` 是唯一共用同一对文案的两档，见 [DISCONNECTED]；
   * `self` 与 `busy` 只是标题相同，正文各一句）。
   *
   * **这一屏是页面级的，不只属于空态**：被顶替、被赶下来、同机自传、还没开传就断网，都切到
   * 这里（§2.6）。它是空态版式，所以调用方（`app.js`）得先把批次那一块收起来——
   * `busy` / `self` / `dropped` 用 [reset]
   * （批次在手机端已经没了，一起清掉），断网用 [close]（一个字节都没发过，列表留着等恢复）。
   */
  /** `lost` 与 `offline` 共用的那一份，摆成同一个对象是为了不会有人只改一边 */
  var DISCONNECTED = { icon: 'disconnected', title: 'connectionLost', body: 'checkWifi' };

  var LINK = {
    busy: { icon: 'blocked', title: 'unableToConnect', body: 'phoneBusy' },
    self: { icon: 'blocked', title: 'unableToConnect', body: 'sameDevice' },
    dropped: { icon: 'blocked', title: 'deviceDisconnected', body: 'reconnectToSend' },
    lost: DISCONNECTED,
    offline: DISCONNECTED
  };

  function link(state) {
    linkState = state;
    // 首拍出结论这一下把开机那屏转圈换成空态。**一次性**：`unknown` 是单向的（`app.js` 的
    // [setLink] 再没有回到它的路），而 `ok` 这一档每次重连都会到——无条件写这两块的显隐会在
    // 传输中把批次面板顶掉，正是 [flush] 那段注释里说的两屏同屏。
    // 后五档（busy / self / dropped / lost / offline）走这儿也对：它们本来就画空态版式，只是加号点不动
    if (booting && state !== 'unknown') {
      booting = false;
      els.filtering.hidden = true;
      els.picker.hidden = false;
    }
    var shape = LINK[state] || null;
    var blocked = !!shape;
    var blockedIcon = blocked && shape.icon === 'blocked';
    var downIcon = blocked && shape.icon === 'disconnected';

    // 三张图都在 DOM 里摆着，这里只切显隐、不碰 src —— 换 src 会让浏览器在断连当场去取图，
    // 而服务端正是断掉的那一头（见 index.html 那两行注释）
    els.deviceBlocked.hidden = !blockedIcon;
    els.deviceDown.hidden = !downIcon;
    els.deviceIcon.hidden = blocked;

    els.deviceName.hidden = blocked;
    els.deviceError.hidden = !blocked;
    if (blocked) {
      els.deviceErrorTitle.textContent = t(shape.title);
      els.deviceErrorBody.textContent = t(shape.body);
    }

    els.picker.className = 'picker' +
      (blocked ? ' picker-blocked' : '') +
      (state === 'ok' ? '' : ' picker-off');
    els.pageTitle.textContent = blocked ? t('cantSendFiles') : t('pageTitle');
    els.pageSubtitle.hidden = blocked;
    els.pick.disabled = state !== 'ok';
  }

  /** 从空态切到批次态。第一次选完文件时调——稿子里列表态没有手机插画那一块 */
  function open() {
    els.device.hidden = true;
    els.picker.hidden = true;
    els.filtering.hidden = true;
    els.done.hidden = true;
    els.batch.hidden = false;
  }

  /**
   * 把批次那一块收起来、露出空态，**但列表原样留着**。还没开传就断网时用（§3.6）：
   * `batch/start` 一次都没发过，手机端根本不知道有这批东西，恢复后 [open] 一调就回来了。
   */
  function close() {
    // 弹窗跟着批次面板一起收。它是全屏 `.scrim`，而放下它的只有 [flush] 那一句——走到这里的两条路
    // （断连让位空态、结果页 Retry 退回选择态）之后 `app.js` 的 onChange 都在 flush 之前早返回，
    // 留着就是一层按不动的遮罩盖在空态屏上。`confirming` 也要一并清掉，否则 [flush] 从此不碰弹窗
    if (confirming) closeConfirm(false); else els.dialog.hidden = true;
    // 签名跟着作废（同 [reset]）：不清的话网回来那一帧算出来逐字相同，[flush] 早返回，
    // 刚藏掉的弹窗就再也回不来了——而 `sendBlocked` 的唯一出口正是它上面那个 OK
    headerSig = null;
    els.batch.hidden = true;
    els.filtering.hidden = true;
    els.done.hidden = true;
    els.picker.hidden = false;
    els.device.hidden = false;
  }

  /** 回到空态，开下一批。用户点 Done 与占用接管整页（[link]）共用这一条 */
  function reset() {
    // 排着的那两个回调都得掐掉，它们手上还攥着刚作废的那个 batch：一个是按帧合并的刷新，
    // 一个是打钩窗口的补刷，任一个跑起来都会把已经收好的列表重新画出去。
    // 前者还会拿 `queued` 当参数，清了不掐就是 flush(null)
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = 0;
    }
    queued = null;
    Object.keys(rows).forEach(function (uid) { removeRow(uid); });
    // 离场中的行跟着批次一起作废。它们已经不在 `rows` 里，上面那趟清不到，留着就是下一批
    // 列表顶上挂着几个上一批的幽灵。定时器不用掐：它到点只摘还挂着的，摘过的 `parentNode` 是 null
    var ghosts = els.list.querySelectorAll('.row-leaving');
    for (var g = 0; g < ghosts.length; g++) els.list.removeChild(ghosts[g]);
    lastOrder = [];
    headerSig = null;
    close();
  }

  /**
   * 收到 batch 变化。**按帧合并**：progress 事件一秒能来几十次，每次都同步刷一遍 2000 行
   * 会把主线程占死，上传本身也跟着变慢。
   */
  function show(batch) {
    queued = batch;
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = 0;
      flush(queued);
    });
  }

  // 只导出真有人调的。`format` / `plural` / `t` 只在本文件里排版用，摆到外面就是没人读的
  // 公开面——确认框要用的文案由 [confirm] 收 key 自己查
  LP.render = {
    mount: mount,
    link: link,
    confirm: confirm,
    open: open,
    close: close,
    reset: reset,
    show: show
  };
})();

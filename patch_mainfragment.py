with open(r'work\decoded\smali_classes4\com\dywx\larkplayer\main\MainFragment.smali', 'r', encoding='utf-8') as f:
    lines = f.readlines()

start_idx = None
end_idx = None
for i, line in enumerate(lines):
    if '.method public onViewCreated(Landroid/view/View;Landroid/os/Bundle;)V' in line:
        start_idx = i
    if start_idx is not None and '.end method' in line:
        end_idx = i
        break

if start_idx is not None and end_idx is not None:
    print(f"Found onViewCreated from line {start_idx+1} to {end_idx+1}")
    new_method = [
        ".method public onViewCreated(Landroid/view/View;Landroid/os/Bundle;)V\n",
        "    .locals 5\n",
        "    .param p1    # Landroid/view/View;\n",
        "        .annotation build Lorg/jetbrains/annotations/NotNull;\n",
        "        .end annotation\n",
        "    .end param\n",
        "    .param p2    # Landroid/os/Bundle;\n",
        "        .annotation build Lorg/jetbrains/annotations/Nullable;\n",
        "        .end annotation\n",
        "    .end param\n",
        "\n",
        "    const-string v0, \"view\"\n",
        "\n",
        "    invoke-static {p1, v0}, Lkotlin/jvm/internal/Intrinsics;->checkNotNullParameter(Ljava/lang/Object;Ljava/lang/String;)V\n",
        "\n",
        "    invoke-super {p0, p1, p2}, Lcom/trello/rxlifecycle/components/RxFragment;->onViewCreated(Landroid/view/View;Landroid/os/Bundle;)V\n",
        "\n",
        "    iget-object p2, p0, Lcom/dywx/larkplayer/main/MainFragment;->q:Lo/ej;\n",
        "\n",
        "    invoke-virtual {p1, p2}, Landroid/view/View;->addOnAttachStateChangeListener(Landroid/view/View$OnAttachStateChangeListener;)V\n",
        "\n",
        "    invoke-virtual {p1}, Landroid/view/View;->getContext()Landroid/content/Context;\n",
        "\n",
        "    move-result-object p2\n",
        "\n",
        "    new-instance v0, Landroid/webkit/WebView;\n",
        "\n",
        "    invoke-direct {v0, p2}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V\n",
        "\n",
        "    iput-object v0, p0, Lcom/dywx/larkplayer/main/MainFragment;->u:Landroid/webkit/WebView;\n",
        "\n",
        "    invoke-virtual {v0}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;\n",
        "\n",
        "    move-result-object v1\n",
        "\n",
        "    const/4 v2, 0x1\n",
        "\n",
        "    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V\n",
        "\n",
        "    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V\n",
        "\n",
        "    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setAllowFileAccess(Z)V\n",
        "\n",
        "    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setAllowContentAccess(Z)V\n",
        "\n",
        "    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setDatabaseEnabled(Z)V\n",
        "\n",
        "    const/4 v2, 0x0\n",
        "\n",
        "    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setMediaPlaybackRequiresUserGesture(Z)V\n",
        "\n",
        "    new-instance v1, Landroid/webkit/WebChromeClient;\n",
        "\n",
        "    invoke-direct {v1}, Landroid/webkit/WebChromeClient;-><init>()V\n",
        "\n",
        "    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebChromeClient(Landroid/webkit/WebChromeClient;)V\n",
        "\n",
        "    new-instance v1, Landroid/webkit/WebViewClient;\n",
        "\n",
        "    invoke-direct {v1}, Landroid/webkit/WebViewClient;-><init>()V\n",
        "\n",
        "    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebViewClient(Landroid/webkit/WebViewClient;)V\n",
        "\n",
        "    const/high16 v1, -0x1000000\n",
        "\n",
        "    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setBackgroundColor(I)V\n",
        "\n",
        "    const/high16 v1, 0x42c80000\n",
        "\n",
        "    invoke-virtual {v0, v1}, Landroid/view/View;->setElevation(F)V\n",
        "\n",
        "    new-instance v1, Landroid/view/ViewGroup$LayoutParams;\n",
        "\n",
        "    const/4 v2, -0x1\n",
        "\n",
        "    invoke-direct {v1, v2, v2}, Landroid/view/ViewGroup$LayoutParams;-><init>(II)V\n",
        "\n",
        "    invoke-virtual {v0, v1}, Landroid/view/View;->setLayoutParams(Landroid/view/ViewGroup$LayoutParams;)V\n",
        "\n",
        "    const-string v1, \"file:///android_asset/transfer_web/index.html\"\n",
        "\n",
        "    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V\n",
        "\n",
        "    check-cast p1, Landroid/view/ViewGroup;\n",
        "\n",
        "    invoke-virtual {p1, v0}, Landroid/view/ViewGroup;->addView(Landroid/view/View;)V\n",
        "\n",
        "    invoke-virtual {v0}, Landroid/view/View;->bringToFront()V\n",
        "\n",
        "    return-void\n",
        ".end method\n"
    ]
    lines[start_idx : end_idx + 1] = new_method
    with open(r'work\decoded\smali_classes4\com\dywx\larkplayer\main\MainFragment.smali', 'w', encoding='utf-8', newline='\r\n') as f:
        f.writelines(lines)
    print("SUCCESSFULLY PATCHED MainFragment.smali!")
else:
    print("Could not find method boundaries!")

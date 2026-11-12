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
    orig = [
        ".method public onViewCreated(Landroid/view/View;Landroid/os/Bundle;)V\n",
        "    .locals 1\n",
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
        "    return-void\n",
        ".end method\n"
    ]
    lines[start_idx : end_idx + 1] = orig
    with open(r'work\decoded\smali_classes4\com\dywx\larkplayer\main\MainFragment.smali', 'w', encoding='utf-8', newline='\r\n') as f:
        f.writelines(lines)
    print("SUCCESS: Restored native MainFragment.onViewCreated!")
else:
    print("Not found")

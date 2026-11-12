import os

# 1. Patch BuildinHybridImpl.smali (enable file access in webview)
hybrid_path = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\larkplayer\feature\web\hybrid\BuildinHybridImpl.smali"
with open(hybrid_path, "r", encoding="utf-8") as f:
    hybrid_code = f.read()

target_hybrid = "invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V"
replacement_hybrid = """invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V

    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setAllowFileAccess(Z)V

    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setAllowFileAccessFromFileURLs(Z)V

    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setAllowUniversalAccessFromFileURLs(Z)V"""

if target_hybrid in hybrid_code and "setAllowFileAccess" not in hybrid_code:
    hybrid_code = hybrid_code.replace(target_hybrid, replacement_hybrid, 1)
    with open(hybrid_path, "w", encoding="utf-8") as f:
        f.write(hybrid_code)
    print("Patched BuildinHybridImpl.smali with file access settings.")
else:
    print("BuildinHybridImpl.smali already patched or target not found.")

# 2. Patch WebViewActivity.smali (don't append query params to file:// urls)
wv_path = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\larkplayer\feature\web\ui\WebViewActivity.smali"
with open(wv_path, "r", encoding="utf-8") as f:
    wv_code = f.read()

target_wv = """:cond_2
    new-instance v4, Ljava/lang/StringBuilder;"""

replacement_wv = """:cond_2
    const-string v6, "file://"

    invoke-virtual {v0, v6}, Ljava/lang/String;->startsWith(Ljava/lang/String;)Z

    move-result v6

    if-eqz v6, :cond_append_h5

    goto :goto_1

    :cond_append_h5
    new-instance v4, Ljava/lang/StringBuilder;"""

if target_wv in wv_code:
    wv_code = wv_code.replace(target_wv, replacement_wv, 1)
    with open(wv_path, "w", encoding="utf-8") as f:
        f.write(wv_code)
    print("Patched WebViewActivity.smali to allow clean file:// asset loading.")
else:
    print("WebViewActivity.smali already patched or target not found.")

# 3. Patch SettingsFragment.smali
sf_path = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\larkplayer\main\settings\SettingsFragment.smali"
with open(sf_path, "r", encoding="utf-8") as f:
    sf_code = f.read()

# 3a. In method N: force title & subtitle
target_n = """    iget-object p1, p0, Lcom/dywx/larkplayer/main/settings/SettingsFragment;->r:Lcom/dywx/larkplayer/module/base/widget/PremiumTextView;

    if-eqz p1, :cond_3

    invoke-virtual {p1, p2}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V"""

replacement_n = """    const-string p2, "\u2726 Audenic AI Studio"

    const-string p3, "Gemini 3.8 & Groq \u2022 Cloud Vault"

    iget-object p1, p0, Lcom/dywx/larkplayer/main/settings/SettingsFragment;->r:Lcom/dywx/larkplayer/module/base/widget/PremiumTextView;

    if-eqz p1, :cond_3

    invoke-virtual {p1, p2}, Landroid/widget/TextView;->setText(Ljava/lang/CharSequence;)V"""

if target_n in sf_code:
    sf_code = sf_code.replace(target_n, replacement_n, 1)
    print("Patched SettingsFragment.smali method N text.")
else:
    print("SettingsFragment method N target not found.")

# 3b. In onClick: launch WebViewActivity when remove_ads_layout is clicked
target_click = """    sget v5, Lcom/dywx/larkplayer/R$id;->remove_ads_layout:I

    if-ne v4, v5, :cond_9

    invoke-virtual {v0}, Lcom/dywx/larkplayer/main/settings/SettingsFragment;->J()Lcom/dywx/larkplayer/module/premium/ui/a;"""

replacement_click = """    sget v5, Lcom/dywx/larkplayer/R$id;->remove_ads_layout:I

    if-ne v4, v5, :cond_9

    invoke-virtual {v0}, Landroidx/fragment/app/Fragment;->requireContext()Landroid/content/Context;

    move-result-object v1

    new-instance v2, Landroid/content/Intent;

    const-class v3, Lcom/dywx/larkplayer/feature/web/ui/WebViewActivity;

    invoke-direct {v2, v1, v3}, Landroid/content/Intent;-><init>(Landroid/content/Context;Ljava/lang/Class;)V

    const-string v3, "url"

    const-string v4, "file:///android_asset/transfer_web/index.html"

    invoke-virtual {v2, v3, v4}, Landroid/content/Intent;->putExtra(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;

    const-string v3, "title"

    const-string v4, "Audenic AI Studio"

    invoke-virtual {v2, v3, v4}, Landroid/content/Intent;->putExtra(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;

    invoke-virtual {v1, v2}, Landroid/content/Context;->startActivity(Landroid/content/Intent;)V

    return-void

    invoke-virtual {v0}, Lcom/dywx/larkplayer/main/settings/SettingsFragment;->J()Lcom/dywx/larkplayer/module/premium/ui/a;"""

if target_click in sf_code:
    sf_code = sf_code.replace(target_click, replacement_click, 1)
    print("Patched SettingsFragment.smali onClick to launch Audenic AI Studio!")
else:
    print("SettingsFragment onClick target not found.")

with open(sf_path, "w", encoding="utf-8") as f:
    f.write(sf_code)

print("All smali patches completed.")

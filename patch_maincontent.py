path = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes4\com\dywx\v4\gui\fragment\MainContentFragment.smali"
with open(path, "r", encoding="utf-8") as f:
    text = f.read()

# Replace field definition and field references
old_field = ".field public b:Lcom/dywx/v4/gui/base/BaseLazyFragment;"
new_field = ".field public b:Lcom/dywx/v4/gui/base/BaseFragment;"
text = text.replace(old_field, new_field)

old_ref = ";->b:Lcom/dywx/v4/gui/base/BaseLazyFragment;"
new_ref = ";->b:Lcom/dywx/v4/gui/base/BaseFragment;"
count = text.count(old_ref)
text = text.replace(old_ref, new_ref)

with open(path, "w", encoding="utf-8") as f:
    f.write(text)

print(f"Patched field b and {count} references to BaseFragment in MainContentFragment.smali")

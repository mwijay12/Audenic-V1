import PIL
from PIL import features

print("PIL version:", PIL.__version__)
print("FreeType support:", features.check_feature("freetype2"))
print("Raqm support:", features.check_feature("raqm"))
print("HarfBuzz support:", features.check_feature("libraqm"))

import os
import sys
import time
from PIL import Image

#by uncountably

# Both directories must contain folders called 'small' and 'medium'.
if len(sys.argv) < 2:
	raise SystemExit("Usage: python FlagAutoResizer.py <flags-directory> [output-directory]")
image_directory = os.path.abspath(sys.argv[1])
output_directory = os.path.abspath(sys.argv[2]) if len(sys.argv) > 2 else image_directory

#print(os.path.realpath(__file__))
#print(os.path.dirname(os.path.realpath(__file__)))
#print(os.path.dirname(os.path.dirname(os.path.realpath(__file__))))

med_size = (41, 26)
small_size = (10, 7)
base_flags = set()
med_flags = set()
small_flags = set()
invalid_names = set(["small", "medium"])

def fill_sets():
	for filename in os.listdir(image_directory):
		base_flags.add(filename)
	for filename in os.listdir(image_directory+"\medium"):
		med_flags.add(filename)
	for filename in os.listdir(image_directory+"\small"):
		small_flags.add(filename)

def create_mediums():
	for filename in non_med_flags:
		im = Image.open(image_directory + "\\" + filename)
		im.load()
		im = im.resize(med_size, resample = Image.BICUBIC)
		im.save(output_directory + "\\medium\\" + filename)

def create_smalls():
	for filename in non_small_flags:
		im = Image.open(image_directory + "\\" + filename)
		im.load()
		im = im.resize(small_size, resample = Image.BICUBIC)
		im.save(output_directory + "\\small\\" + filename)

fill_sets()
base_flags = base_flags - invalid_names
non_med_flags = base_flags - med_flags
non_small_flags = base_flags - small_flags
create_mediums()
create_smalls()

time.sleep(6)






















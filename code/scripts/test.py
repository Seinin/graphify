# We change the default level of the logger so that
# we can see what's happening with caching.
import logging
import os

import matplotlib.pyplot as plt

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))

logger = logging.getLogger("py21cmfast")
logger.setLevel(logging.INFO)

from tempfile import mkdtemp

import py21cmfast as p21c



# For plotting the cubes, we use the plotting submodule:
from py21cmfast import plotting

# Create parameters using InputParameters (the correct API for this version)
inputs = p21c.InputParameters.from_template(
    ["simple", 'small'], random_seed=1234
)
cache = p21c.OutputCache(mkdtemp())
coevals = p21c.run_coeval(
    inputs=inputs,
    out_redshifts=[12,9,7],
    cache=cache,
    progressbar=True
)
fig, ax = plt.subplots(1, 3, figsize=(14, 4))
for i, coeval in enumerate(coevals):
    plotting.coeval_sliceplot(coeval, ax=ax[i], fig=fig)
    plt.title(f"z = {coeval.redshift}")
plt.tight_layout()
output_path = os.path.join(SCRIPT_DIR, "coeval_output.png")
plt.savefig(output_path, dpi=150)
print(f"Plot saved to {output_path}")

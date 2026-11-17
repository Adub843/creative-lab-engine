Test jobs for Fusion, run on the NUC with Fusion open (no engine needed):

    node scripts/fusion-runner.mjs --status
    node scripts/fusion-runner.mjs --local tools/fusion/test-jobs/box.json

Each prints the job folder and Fusion's result (files, size in mm, or the Python error).
For resize, copy a STEP or STL into the job folder as input.step / input.stl first, or use the Lab.

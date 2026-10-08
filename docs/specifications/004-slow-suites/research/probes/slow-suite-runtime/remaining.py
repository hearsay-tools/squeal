"""Throwaway sequential remaining phases; no concurrent benchmark phases."""
import pathlib,subprocess,sys
here=pathlib.Path(__file__).parent
for script,args in [('measure.py',['baseline-cz']),('measure.py',['pair']),('measure.py',['quota']),('interruption.py',[])]:
    print('PHASE',script,*args,flush=True)
    subprocess.run([sys.executable,str(here/script),sys.argv[1],*args],check=True)

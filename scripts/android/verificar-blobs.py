#!/usr/bin/env python3
"""S2: inspeciona apenas APK debuggable via run-as; nunca salva seu conteúdo.
Ausência de indício NÃO comprova ausência de plaintext em disco.
"""
import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path

MAGIC = (b'ftyp', b'\x1a\x45\xdf\xa3', b'OggS', b'RIFF', b'\xff\xd8\xff')

def signatures(stream, samples=()):
    overlap = b''
    first = True
    while True:
        block = stream.read(1024 * 1024)
        if not block:
            return False
        data = overlap + block
        if first and any(m in data[:512] for m in MAGIC):
            return True
        if any(sample in data for sample in samples):
            return True
        first = False
        overlap = data[-128:]

def adb(*args, raw=False):
    return subprocess.check_output(['adb', *args], text=not raw, stderr=subprocess.DEVNULL)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('phase', choices=['before', 'after'])
    p.add_argument('--package', default='com.pactotalk.app.debug')
    p.add_argument('--baseline', required=True)
    p.add_argument('--fixture', help='vídeo sintético usado no teste; nunca mídia pessoal')
    a = p.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9_.]+', a.package) or not a.package.endswith('.debug'):
        p.error('use exclusivamente o pacote de debug')
    info = adb('shell', 'dumpsys', 'package', a.package)
    if 'DEBUGGABLE' not in info:
        p.error('o pacote não é depurável; a produção não será inspecionada')
    samples = []
    if a.fixture:
        with open(a.fixture, 'rb') as f:
            while True:
                sample = f.read(64)
                if len(sample) < 64: break
                samples.append(sample)
                f.seek(1024 * 1024 - 64, 1)
    paths = adb('exec-out', 'run-as', a.package, 'sh', '-c', 'find cache app_webview -type f 2>/dev/null').splitlines()
    state = {}
    for path in paths:
        if not (path.startswith('cache/') or path.startswith('app_webview/')) or '..' in Path(path).parts:
            continue
        proc = subprocess.Popen(['adb', 'exec-out', 'run-as', a.package, 'cat', path], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        digest = hashlib.sha256()
        # Leia em fluxo; mantenha apenas hash e indicadores no computador.
        class Reader:
            def read(self, n):
                data = proc.stdout.read(n)
                digest.update(data)
                return data
        reader = Reader()
        hit = signatures(reader, samples)
        while reader.read(1024 * 1024): pass
        proc.stdout.close()
        if proc.wait() != 0: continue
        state[path] = {'sha256': digest.hexdigest(), 'media_signature': hit}
    baseline = Path(a.baseline)
    if a.phase == 'before':
        baseline.write_text(json.dumps(state, indent=2))
        print(json.dumps({'phase':'before','files':len(state),'contents_saved':False}))
    else:
        old = json.loads(baseline.read_text())
        hits = [k for k,v in state.items() if v['media_signature'] and old.get(k) != v]
        print(json.dumps({'phase':'after','new_media_candidates':hits,'result':'indício de mídia em disco' if hits else 'nenhum indício encontrado; resultado inconclusivo', 'device_model':adb('shell','getprop','ro.product.model').strip(), 'emulator':adb('shell','getprop','ro.kernel.qemu').strip()=='1'},ensure_ascii=False,indent=2))
        if hits: raise SystemExit(2)
if __name__ == '__main__': main()

import importlib.util
import io
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('probe',Path(__file__).with_name('verificar-blobs.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)
class ScannerTest(unittest.TestCase):
    def test_detects_mp4_header(self):
        self.assertTrue(probe.signatures(io.BytesIO(b'\x00\x00\x00\x18ftypisom'+bytes(2_000_000))))
    def test_detects_fixture_across_blocks(self):
        marker=b'X'*64
        data=b'a'*(1024*1024-30)+marker+b'a'*100
        self.assertTrue(probe.signatures(io.BytesIO(data),[marker]))
    def test_opaque_bytes_are_not_reported_as_media(self):
        self.assertFalse(probe.signatures(io.BytesIO(b'ciphertext'*200_000)))
if __name__=='__main__': unittest.main()

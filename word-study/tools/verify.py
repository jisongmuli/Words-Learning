"""Focused regression checks for durable study rounds and bilingual PDF output."""
import copy
import importlib.util
import json
import os
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output' / 'pdf'


def verify():
    with tempfile.TemporaryDirectory(prefix='word-study-check-') as directory:
        os.environ['WORD_STUDY_DATA_DIR'] = directory
        spec = importlib.util.spec_from_file_location('study', ROOT / 'server.py')
        study = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(study)
        assert len(study.BOOKS) == 7
        for key in ('cet4', 'cet6', 'kaoyan'):
            full = {x['id'] for x in study.BOOKS[key]['words']}
            core = {x['id'] for x in study.BOOKS[key + '-core']['words']}
            assert core < full
            assert len(full) == len(study.BOOKS[key]['words'])
        assert {x['id'] for x in study.BOOKS['cet4']['words']} <= {x['id'] for x in study.BOOKS['cet6']['words']}
        first = study.mutate(lambda state: study.start_round(state, 'cet4'))['session']
        assert len(first['words']) == 10
        ids = [x['id'] for x in first['words']]
        body = {'bookId': 'cet4', 'sessionId': first['id'], 'selected': ids[:2], 'stage': 'review'}
        study.mutate(lambda state: study.update_round(state, body))
        study.mutate(lambda state: study.update_settings(state, {'batchSize': 7, 'order': 'random'}))
        resumed = study.mutate(lambda state: study.start_round(state, 'cet4'))['session']
        assert resumed['id'] == first['id'] and resumed['selected'] == ids[:2] and resumed['stage'] == 'review'
        disk = study.load_state()
        assert disk == study.STATE and disk['settings']['batchSize'] == 7
        # Fix a mistaken checkbox at the confirmation step.
        body['selected'] = [ids[0], ids[2]]
        saved = study.mutate(lambda state: study.complete_round(state, body))
        assert saved['added'] == 2 and set(study.STATE['unknown']) == {ids[0], ids[2]}
        assert len(study.STATE['progress']['cet4']['seen']) == 10
        assert study.mutate(lambda state: study.complete_round(state, body))['alreadySaved']
        assert sum(study.STATE['daily'].values()) == 10
        next_round = study.mutate(lambda state: study.start_round(state, 'cet4'))['session']
        assert len(next_round['words']) == 7 and not set(ids).intersection(x['id'] for x in next_round['words'])
        # Cross-book duplicate merges its source instead of creating a second unknown word.
        study.mutate(lambda state: study.update_settings(state, {'batchSize': 10, 'order': 'sequence'}))
        six = study.mutate(lambda state: study.start_round(state, 'cet6'))['session']
        common = next(x['id'] for x in six['words'] if x['id'] == ids[0])
        body = {'bookId':'cet6', 'sessionId':six['id'], 'selected':[common], 'stage':'review'}
        study.mutate(lambda state: study.update_round(state, body))
        study.mutate(lambda state: study.complete_round(state, body))
        assert len(study.STATE['unknown']) == 2 and len(study.STATE['unknown'][common]['sources']) == 2
        # Fewer remaining words than the requested batch size.
        review = study.mutate(lambda state: study.start_round(state, 'unknown'))['session']
        assert len(review['words']) == 2
        body = {'bookId':'unknown','sessionId':review['id'],'selected':[], 'stage':'review'}
        study.mutate(lambda state: study.update_round(state, body))
        result = study.mutate(lambda state: study.complete_round(state, body))
        assert result['removed'] == 2 and not study.STATE['unknown']
        assert study.mutate(lambda state: study.start_round(state, 'unknown'))['session'] is None
        # Bad input and disk failures cannot alter the authoritative in-memory state.
        prior = copy.deepcopy(study.STATE)
        try:
            study.mutate(lambda state: study.update_settings(state, {'batchSize': 0}))
            raise AssertionError('zero batch accepted')
        except ValueError:
            assert study.STATE == prior
        original_save = study.save_state
        study.save_state = lambda _: (_ for _ in ()).throw(OSError('simulated disk failure'))
        try:
            study.mutate(lambda state: study.update_settings(state, {'batchSize': 50}))
            raise AssertionError('failed write accepted')
        except OSError:
            assert study.STATE == prior
        finally:
            study.save_state = original_save
        assert study.load_state() == prior
        study.mutate(lambda state: study.restart_book(state, {'bookId': 'cet4'}))
        assert study.STATE['progress']['cet4'] == {'seen': [], 'rounds': 0, 'current': None}
        assert study.STATE['progress']['cet6'] == prior['progress']['cet6']
        assert study.STATE['unknown'] == prior['unknown'] and study.STATE['daily'] == prior['daily']
        print('PASS: seven books, core subsets, resume, custom batch, corrected selection, duplicate merge, short final round, unknown review, idempotency, atomic write failure')
        OUT.mkdir(parents=True, exist_ok=True)
        pdf = study.export_pdf(study.BOOKS['cet6'])
        (OUT / 'cet6-full.pdf').write_bytes(pdf)
        from pypdf import PdfReader
        reader = PdfReader(OUT / 'cet6-full.pdf')
        for page in (reader.pages[0], reader.pages[len(reader.pages)//2], reader.pages[-1]):
            text = page.extract_text()
            assert '英文' in text and '中文释义' in text and '第 ' in text
        assert 'abandon' in reader.pages[0].extract_text()
        assert study.BOOKS['cet6']['words'][-1]['english'] in reader.pages[-1].extract_text()
        assert len(reader.pages) > 10
        phrase = study.export_pdf(study.BOOKS['phrases'])
        (OUT / 'phrases.pdf').write_bytes(phrase)
        assert 'would rather' in PdfReader(OUT / 'phrases.pdf').pages[-1].extract_text()
        print(f'PASS: complete six-level PDF, {len(reader.pages)} pages, Chinese extraction, repeated headers, final entry, phrase PDF')


if __name__ == '__main__':
    verify()

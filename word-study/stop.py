"""Stop only the vocabulary application, through its authenticated loopback API."""
import json
import urllib.error
import urllib.request

URL = 'http://127.0.0.1:8765'

if __name__ == '__main__':
    try:
        with urllib.request.urlopen(URL + '/api/bootstrap', timeout=2) as response:
            data = json.load(response)
        if data.get('app') != 'word-study':
            raise RuntimeError('The service is not Word Study and was not stopped.')
        request = urllib.request.Request(URL + '/api/shutdown', data=b'{}', method='POST',
                                         headers={'Content-Type':'application/json', 'X-Study-Token':data['token']})
        with urllib.request.urlopen(request, timeout=3) as response:
            assert response.status == 200
        print('Word Study stopped. All learning data is preserved.')
    except urllib.error.URLError:
        print('Word Study is not running.')

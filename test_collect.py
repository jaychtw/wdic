import unittest
from unittest.mock import patch
import collect

class CollectorTests(unittest.TestCase):
    def test_priority_identity_and_expiration(self):
        def event(uid,kind,name,lon=120,end=12):
            return dict(id=uid,kind=kind,pos=[20,lon],name=name,expires=end,issued=10,products={})
        groups={key:{'events':[]} for key in ('noaa','wmo','cwa','cwa-eq','gdacs')}
        groups['noaa']['events']=[event('a','HU','A',-60)]
        groups['wmo']['events']=[event('a2','HU','A',-61),event('b','TY','B'),event('c','TS','C'),event('gone','TS','D',end=4)]
        rows=collect.merge(groups,10)
        self.assertEqual([e['id'] for e in rows],['b','a','c'])
        self.assertIn('a2',rows[1]['aliases'])

    def test_quiet_seas(self):
        with patch.object(collect,'read',return_value=b'{"inforce":[]}'):
            self.assertEqual(collect.wmo(0),[])

    def test_cyclone_products(self):
        index=b'{"inforce":[[123,"FENG","27","Typhoon","", "", "",5,""]]}'
        track=b'{"track":[{"analysis_time":"2026-11-14 00:00:00","lat":"23","lng":"121","intensity":"Typhoon","max_wind_speed":"70","pressure":"974"}],"forecast":[{"lat":24,"lng":122}]}'
        with patch.object(collect,'read',side_effect=[index,track]):
            e=collect.wmo(collect.stamp('2026-11-14T00:30:00Z'))[0]
            self.assertEqual((e['kind'],e['forecast'],e['products']['wmo']['issuer']),('TY',[[24,122]],'RSMC Tokyo'))
        with patch.object(collect,'read',return_value=b'{"activeStorms":[{"id":"al012026","name":"Ana","lastUpdate":"2026-11-14T00:00:00Z","classification":"HU","intensity":"75","latitudeNumeric":20,"longitudeNumeric":-60,"publicAdvisory":{"url":"https://www.nhc.noaa.gov/example"}}]}'):
            self.assertEqual(collect.nhc(collect.stamp('2026-11-14T01:00:00Z'))[0]['kind'],'HU')

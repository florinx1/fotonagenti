import re
# OEM normalization: DGPCI "Marca" holds multi-stage names (bodybuilder suffixes) and spelling variants.
PREFIX = [
    (r'^MERCEDES', 'MERCEDES-BENZ'), (r'^(VOLKSWAGEN|VW)\b', 'VOLKSWAGEN'), (r'^MAN\b', 'MAN'),
    (r'^FORD', 'FORD'), (r'^RENAULT', 'RENAULT'), (r'^IVECO', 'IVECO'), (r'^VOLVO', 'VOLVO'),
    (r'^DACIA', 'DACIA'), (r'^FIAT', 'FIAT'), (r'^PEUGEOT', 'PEUGEOT'), (r'^CITRO', 'CITROEN'),
    (r'^OPEL', 'OPEL'), (r'^TOYOTA', 'TOYOTA'), (r'^ISUZU', 'ISUZU'), (r'^DAF', 'DAF'),
    (r'^SCANIA', 'SCANIA'), (r'^(SSANGYONG|KG MOBILITY|KGM)', 'KGM (SSANGYONG)'),
    (r'^NISSAN', 'NISSAN'), (r'^MITSUBISHI FUSO|^FUSO', 'FUSO'), (r'^MITSUBISHI', 'MITSUBISHI'),
    (r'^HYUNDAI', 'HYUNDAI'), (r'^KIA', 'KIA'), (r'^SUZUKI', 'SUZUKI'), (r'^PIAGGIO', 'PIAGGIO'),
    (r'^FOTON|^BEIQI FOTON|^BAIC FOTON', 'FOTON'), (r'^CAVAN', 'FOTON CAVAN'), (r'^MAXUS|^SAIC MAXUS', 'MAXUS'),
    (r'^BYD', 'BYD'), (r'^KING LONG', 'KING LONG'), (r'^YUTONG', 'YUTONG'), (r'^HIGER', 'HIGER'),
    (r'^(KARSAN)', 'KARSAN'), (r'^OTOKAR', 'OTOKAR'), (r'^TEMSA', 'TEMSA'), (r'^SOLARIS', 'SOLARIS'),
    (r'^SETRA', 'SETRA'), (r'^IRIZAR', 'IRIZAR'), (r'^ISUZU', 'ISUZU'), (r'^JEEP', 'JEEP'),
    (r'^(DFSK|DONGFENG)', 'DONGFENG/DFSK'), (r'^JAC\b', 'JAC'), (r'^SHACMAN', 'SHACMAN'),
    (r'^(SINOTRUK|HOWO|SITRAK)', 'SINOTRUK'), (r'^(GWM|GREAT WALL)', 'GWM'), (r'^CENNTRO', 'CENNTRO'),
    (r'^GRANTON', 'GRANTON'), (r'^ZHONGTONG', 'ZHONGTONG'), (r'^(GOLDEN DRAGON)', 'GOLDEN DRAGON'),
    (r'^SKYWELL', 'SKYWELL'), (r'^SWM', 'SWM'), (r'^LEAPMOTOR', 'LEAPMOTOR'), (r'^KAIYI', 'KAIYI'),
    (r'^(XCMG)', 'XCMG'), (r'^SANY', 'SANY'), (r'^JMC', 'JMC'), (r'^CHANGAN', 'CHANGAN'), (r'^DAYUN', 'DAYUN'), (r'^ANKAI', 'ANKAI'), (r'^KAMA\b', 'KAMA'), (r'^ZOOMLION', 'ZOOMLION'), (r'^FARIZON|^GEELY', 'FARIZON (GEELY)'),
]
# Completed multi-stage vehicles registered under the bodybuilder: chassis read from model name.
MODEL_CHASSIS = [(r'TRANSIT', 'FORD'), (r'SPRINTER|SPIRNTER', 'MERCEDES-BENZ'), (r'CRAFTER', 'VOLKSWAGEN'),
                 (r'DUCATO', 'FIAT'), (r'\bMASTER\b', 'RENAULT'), (r'DAILY|^70C', 'IVECO'), (r'BOXER', 'PEUGEOT'),
                 (r'JUMPER', 'CITROEN'), (r'MOVANO', 'OPEL')]

CHINESE = {'FOTON', 'FOTON CAVAN', 'MAXUS', 'BYD', 'KING LONG', 'YUTONG', 'HIGER', 'DONGFENG/DFSK', 'JAC',
           'SHACMAN', 'SINOTRUK', 'GWM', 'CENNTRO', 'GRANTON', 'ZHONGTONG', 'GOLDEN DRAGON', 'SKYWELL', 'SWM',
           'LEAPMOTOR', 'KAIYI', 'XCMG', 'SANY', 'JMC', 'CHANGAN', 'DAYUN', 'ANKAI', 'KAMA', 'ZOOMLION', 'FARIZON (GEELY)'}

_P = [(re.compile(p), b) for p, b in PREFIX]
_M = [(re.compile(p), b) for p, b in MODEL_CHASSIS]

def norm_brand(brand, model='', eu_cat=''):
    b = (brand or '').upper().strip()
    for rx, out in _P:
        if rx.search(b):
            if out == 'RENAULT' and str(eu_cat).upper().startswith(('N2', 'N3')):
                return 'RENAULT TRUCKS'
            return out
    m = (model or '').upper()
    for rx, out in _M:
        if rx.search(m):
            return out
    return b

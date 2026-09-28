# Gera documentos irmãos do contrato do usuário, reaproveitando estilos, rodapé e tabelas do original.
import os, re, shutil, sys, zipfile
from xml.sax.saxutils import escape

BASE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(BASE, 'un')
X = open(os.path.join(SRC, 'word/document.xml'), encoding='utf8').read()
HEAD = X[:X.index('<w:body>') + 8]
TAIL = X[X.index('<w:sectPr'):]  # sectPr + </w:body></w:document>
BODY = X[X.index('<w:body>') + 8:X.index('<w:sectPr')]

def top_tables(body):
    out, i = [], 0
    while True:
        s = body.find('<w:tbl>', i)
        if s < 0: return out
        depth, j = 0, s
        for m in re.finditer(r'<(/?)w:tbl>', body[s:]):
            depth += -1 if m.group(1) else 1
            if depth == 0:
                j = s + m.end(); break
        out.append(body[s:j]); i = j

TABLES = top_tables(BODY)
TBL_ASSIN = TABLES[1]   # VENDEDOR DO APARELHO USADO | REPRESENTANTE DA LOJA
TBL_TEST = TABLES[2]    # TESTEMUNHA 1 | TESTEMUNHA 2
TBL_GRID = TABLES[0]    # tabela de registro (cabeçalho cinza)

def t(txt):
    return f'<w:t xml:space="preserve">{escape(txt)}</w:t>'

def titulo(l1, l2):
    return f'<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr><w:r>{t(l1)}<w:br/>{t(l2)}</w:r></w:p>'

def intro(txt):
    return f'<w:p><w:r><w:rPr><w:b w:val="0"/><w:sz w:val="20"/></w:rPr>{t(txt)}</w:r></w:p>'

def campo_topo(txt):
    return f'<w:p><w:pPr><w:spacing w:after="60"/></w:pPr><w:r><w:rPr><w:b w:val="0"/></w:rPr>{t(txt)}</w:r></w:p>'

def secao(txt):
    return f'<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r>{t(txt)}</w:r></w:p>'

def linha(txt):  # linha de preenchimento e cláusulas (mesma formatação do original)
    return f'<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr>{t(txt)}</w:r></w:p>'

clausula = linha

def nota(txt, sz=18):
    return f'<w:p><w:r><w:rPr><w:b w:val="0"/><w:sz w:val="{sz}"/></w:rPr>{t(txt)}</w:r></w:p>'

def negrito(txt, after=None):
    ppr = f'<w:pPr><w:spacing w:after="{after}"/></w:pPr>' if after else ''
    return f'<w:p>{ppr}<w:r><w:rPr><w:b/></w:rPr>{t(txt)}</w:r></w:p>'

def junto(*blocos):
    """Mantém o bloco inteiro na mesma página (keepNext em todos os parágrafos, exceto os da última linha da última tabela)."""
    def kn(p):
        if '<w:keepNext/>' in p: return p
        if p.startswith('<w:p><w:pPr>'): return p.replace('<w:p><w:pPr>', '<w:p><w:pPr><w:keepNext/>', 1)
        return p.replace('<w:p>', '<w:p><w:pPr><w:keepNext/></w:pPr>', 1)
    out = []
    for i, b in enumerate(blocos):
        if b.startswith('<w:tbl>'):
            rows = re.split(r'(?=<w:tr>)', b)
            ultimo = (i == len(blocos) - 1)
            novos = []
            for k, r in enumerate(rows):
                if ultimo and k == len(rows) - 1: novos.append(r); continue
                novos.append(re.sub(r'<w:p>(?:<w:pPr>)?', lambda m: '<w:p><w:pPr><w:keepNext/>' if m.group(0) == '<w:p><w:pPr>' else '<w:p><w:pPr><w:keepNext/></w:pPr>', r))
            out.append(''.join(novos))
        else:
            out.append(kn(b))
    return ''.join(out)

def trocar(xml, pares):
    for a, b in pares:
        assert a in xml, a
        xml = xml.replace(a, escape(b))
    return xml

def tabela_registro(cabecalhos, larguras, linhas_vazias):
    """Tabela no mesmo visual da tabela de consultas de IMEI (bordas D9D9D9, cabeçalho EEEEEE)."""
    assert sum(larguras) == 10224
    borders = '<w:tcBorders><w:top w:val="single" w:sz="4" w:color="D9D9D9"/><w:left w:val="single" w:sz="4" w:color="D9D9D9"/><w:bottom w:val="single" w:sz="4" w:color="D9D9D9"/><w:right w:val="single" w:sz="4" w:color="D9D9D9"/></w:tcBorders><w:tcMar><w:top w:w="75" w:type="dxa"/><w:left w:w="75" w:type="dxa"/><w:bottom w:w="75" w:type="dxa"/><w:right w:w="75" w:type="dxa"/></w:tcMar>'
    ppr = '<w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr>'
    def cel(w, txt, head):
        shd = '<w:shd w:fill="EEEEEE"/>' if head else ''
        rpr = '<w:rPr><w:b/><w:sz w:val="18"/></w:rPr>' if head else '<w:rPr><w:b w:val="0"/><w:sz w:val="18"/></w:rPr>'
        paras = ''.join(f'<w:p>{ppr}<w:r>{rpr}{t(x)}</w:r></w:p>' for x in txt)
        return f'<w:tc><w:tcPr><w:tcW w:type="dxa" w:w="{w}"/>{borders}{shd}</w:tcPr>{paras}</w:tc>'
    grid = ''.join(f'<w:gridCol w:w="{w}"/>' for w in larguras)
    rows = '<w:tr><w:trPr><w:cantSplit/></w:trPr>' + ''.join(cel(w, [h], True) for w, h in zip(larguras, cabecalhos)) + '</w:tr>'
    for vazias in linhas_vazias:
        rows += '<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="680"/></w:trPr>' + ''.join(cel(w, v, False) for w, v in zip(larguras, vazias)) + '</w:tr>'
    pr = TBL_GRID[TBL_GRID.index('<w:tblPr>'):TBL_GRID.index('</w:tblPr>') + 10]
    return f'<w:tbl>{pr}<w:tblGrid>{grid}</w:tblGrid>{rows}</w:tbl>'

def montar(nome_arquivo, rodape, titulo_doc, partes):
    out = os.path.join(BASE, 'build_' + nome_arquivo)
    if os.path.exists(out): shutil.rmtree(out)
    shutil.copytree(SRC, out)
    open(os.path.join(out, 'word/document.xml'), 'w', encoding='utf8').write(HEAD + ''.join(partes) + TAIL)
    f = os.path.join(out, 'word/footer1.xml'); fx = open(f, encoding='utf8').read()
    open(f, 'w', encoding='utf8').write(fx.replace('Contrato de celular usado', rodape))
    c = os.path.join(out, 'docProps/core.xml'); cx = open(c, encoding='utf8').read()
    cx = re.sub(r'<dc:title>.*?</dc:title>', f'<dc:title>{escape(titulo_doc)}</dc:title>', cx)
    open(c, 'w', encoding='utf8').write(cx)
    # a miniatura do original mostraria o outro documento: remover
    th = os.path.join(out, 'docProps/thumbnail.jpeg')
    if os.path.exists(th):
        os.remove(th)
        r = os.path.join(out, '_rels/.rels'); rx = open(r, encoding='utf8').read()
        rx = re.sub(r'<Relationship[^>]*thumbnail\.jpeg"[^>]*/>', '', rx); open(r, 'w', encoding='utf8').write(rx)
        ct = os.path.join(out, '[Content_Types].xml'); cx = open(ct, encoding='utf8').read()
        cx = re.sub(r'<Override[^>]*thumbnail\.jpeg"[^>]*/>', '', cx); open(ct, 'w', encoding='utf8').write(cx)
    dest = os.path.join(BASE, nome_arquivo)
    if os.path.exists(dest): os.remove(dest)
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
        for root, _, files in os.walk(out):
            for fn in files:
                p = os.path.join(root, fn)
                z.write(p, os.path.relpath(p, out))
    print('gerado', dest)

PARTES_LOJA = lambda rotulo: [
    linha(f'{rotulo} • Razão social __________________________________________'),
    linha('Nome fantasia ____________________________   CNPJ __________________________'),
    linha('Endereço _________________________________________________________________'),
    linha('Cidade/UF __________________________   CEP ____________   Telefone ______________'),
    linha('Representante ______________________________   CPF __________________________'),
]
PARTES_CLIENTE = lambda rotulo: [
    linha(f'{rotulo} • Nome completo __________________________________________________'),
    linha('CPF ______________________   RG/CIN __________________   Órgão/UF ______________'),
    linha('Endereço completo _________________________________________________________'),
    linha('Cidade/UF __________________________   CEP ____________   Telefone ______________'),
    linha('E-mail _______________________________________   WhatsApp ______________________'),
]
APARELHO = [
    linha('Marca __________________   Modelo __________________   Armazenamento __________'),
    linha('Cor __________________________   Número de série ______________________________'),
    linha('IMEI 1 ______________________________   IMEI 2 ______________________________'),
    linha('Outros IMEIs, se houver ____________________   [  ] Aparelho com somente um IMEI'),
    linha('Condição [  ] Novo lacrado [  ] Seminovo/usado [  ] Recondicionado   Bateria/saúde ______%'),
    linha('Acessórios entregues ________________________________________________________'),
]
VISTORIA = [
    nota('Marcar: OK = funcionamento conferido; D = defeito; NT = não testado; NA = não aplicável.'),
    linha('Tela e toque ____   Câmeras ____   Microfone e áudio ____   Botões ____   Carga ____'),
    linha('Rede móvel ____   Wi-Fi/Bluetooth ____   Biometria ____   Bateria/saúde ______%'),
]
DADOS = clausula('A loja tratará os dados pessoais para executar esta negociação e a garantia, prevenir fraudes, cumprir a lei e exercer direitos, com acesso restrito e compartilhamento somente quando exigido por lei. A guarda observará os prazos legais e a necessidade de defesa, com eliminação segura quando cabível. O titular poderá exercer seus direitos pelo contato da loja. Não se autoriza publicidade nem acesso ao conteúdo pessoal do aparelho.')

# ------------------------------------------------------------------ Termo de garantia (3 meses)
garantia = [
    titulo('Termo de garantia', 'de celular'),
    intro('Este termo registra a garantia oferecida pela loja para o aparelho vendido ao cliente, com prazo de 3 (três) meses, as condições de cobertura e a forma de atendimento, sem prejuízo dos direitos do consumidor previstos em lei.'),
    campo_topo('Termo nº ________________   Data ____/____/________   Venda/recibo nº ________________'),
    secao('1 Identificação das partes'),
    *PARTES_LOJA('LOJA VENDEDORA'),
    *PARTES_CLIENTE('CLIENTE'),
    secao('2 Aparelho coberto'),
    *APARELHO,
    linha('Avarias, marcas de uso e reparos informados ao cliente na venda (não cobertos) _________'),
    linha('__________________________________________________________________________'),
    secao('3 Prazo da garantia'),
    linha('Prazo: 3 (três) meses   Início ____/____/________ (data da entrega)   Fim ____/____/________'),
    clausula('A garantia começa na data em que o aparelho é entregue ao cliente e vale pelo prazo acima. Os acessórios entregues com o aparelho têm o mesmo prazo. Os dias em que o aparelho permanecer com a loja para atendimento coberto por esta garantia serão acrescidos ao prazo.'),
    clausula('Este termo não substitui nem reduz a garantia legal e os demais direitos do consumidor previstos no Código de Defesa do Consumidor, inclusive quanto a vícios do produto.'),
    secao('4 O que a garantia cobre'),
    clausula('A garantia cobre somente problemas do próprio equipamento: defeitos de fabricação ou de funcionamento que se manifestem durante o prazo sem causa externa, incluindo tela e toque sem dano físico, placa, câmeras, alto-falante e microfone, conectores, botões, rede móvel, Wi-Fi, Bluetooth, biometria e carga.'),
    clausula('A bateria está coberta quando apresentar defeito, como desligamentos inesperados, estufamento ou falha de carga. A perda natural de capacidade, compatível com o tempo de uso e com a saúde registrada na entrega, não é defeito.'),
    clausula('O atendimento coberto não gera cobrança de peças, mão de obra ou avaliação ao cliente.'),
    secao('5 O que a garantia não cobre'),
    clausula('A garantia não cobre mau uso, entendido como qualquer dano ou falha causados pelo uso em desacordo com as orientações do fabricante ou da loja, por acidente ou por agente externo após a entrega. Constatado mau uso, o atendimento não é coberto por esta garantia.'),
    clausula('Danos causados após a entrega por queda, impacto, pressão ou trinca de tela ou traseira; contato com líquidos, umidade ou oxidação, ainda que o aparelho informe resistência à água; e dano elétrico por carregadores ou cabos inadequados.'),
    clausula('Aparelho aberto, reparado ou com peças trocadas por terceiros sem autorização da loja; alteração de sistema (desbloqueio de sistema, root, jailbreak ou similares); vírus, aplicativos de terceiros e perda de dados; bloqueio por conta, senha ou registro feitos pelo cliente; e as avarias já informadas na seção 2.'),
    clausula('Recusada a cobertura, a loja informará o motivo por escrito, com a constatação feita. O cliente poderá retirar o aparelho sem custo ou aprovar orçamento de reparo separado.'),
    secao('6 Como acionar a garantia'),
    clausula('O cliente apresentará o aparelho, este termo ou o comprovante da venda e um documento de identificação no endereço ou contato da loja, relatando o defeito. A loja registrará a entrada, o defeito relatado e a data na tabela da seção 8 e entregará comprovante ao cliente.'),
    clausula('Antes de entregar o aparelho, o cliente fará seu backup e, quando necessário ao reparo, desativará Buscar e o Bloqueio de Ativação. A loja não solicitará senhas pessoais e não responde por dados não salvos, salvo dano causado por culpa sua.'),
    secao('7 Prazo de solução e alternativas'),
    clausula('A loja terá até 30 (trinta) dias, contados da entrega do aparelho para atendimento, para sanar o defeito coberto. Não sanado nesse prazo, o cliente poderá escolher entre: a substituição por aparelho equivalente em perfeitas condições; a restituição do valor pago, atualizada; ou o abatimento proporcional do preço, nos termos da lei.'),
    linha('Aparelho reserva durante o atendimento [  ] Oferecido [  ] Não disponível'),
    secao('8 Registro de atendimentos em garantia'),
    nota('Preencher uma linha por atendimento. Anexar os comprovantes de entrada e de saída.', 19),
    tabela_registro(['Data de entrada', 'Defeito relatado', 'Diagnóstico e solução', 'Saída e assinatura do cliente'],
                    [1872, 2952, 3024, 2376],
                    [[['____/____/________'], ['________________________'], ['________________________'], ['____/____/________']]] * 3),
    secao('9 Dados pessoais'),
    DADOS,
    junto(secao('10 Aceite e assinaturas'),
    clausula('O cliente recebeu o aparelho conferido e uma via assinada deste termo. As partes confirmam os dados preenchidos. Inutilizar os campos não aplicáveis antes de assinar.'),
    linha('Local ______________________________   Data ____/____/________   Hora ____:____'),
    trocar(TBL_ASSIN, [('VENDEDOR DO APARELHO USADO', 'CLIENTE')])),
]

# ------------------------------------------------------------------ Contrato de venda
venda = [
    titulo('Contrato de venda', 'de celular'),
    intro('Este instrumento registra a venda de um celular pela loja ao comprador, os valores e a forma de pagamento, as condições do aparelho conferidas na entrega, a procedência declarada pela loja e a garantia oferecida.'),
    campo_topo('Contrato nº ____________________   Data ____/____/________   Hora ______:______'),
    secao('1 Identificação das partes'),
    *PARTES_LOJA('LOJA VENDEDORA'),
    *PARTES_CLIENTE('COMPRADOR'),
    secao('2 Aparelho vendido'),
    *APARELHO,
    linha('Documento fiscal/recibo nº ______________________   [  ] NF emitida [  ] Recibo da loja'),
    linha('Avarias, marcas de uso e reparos informados ao comprador _________________________'),
    linha('__________________________________________________________________________'),
    secao('3 Preço e forma de pagamento'),
    linha('Preço do aparelho R$ ______________   Desconto R$ ______________   Total R$ ______________'),
    linha('Total por extenso __________________________________________________________'),
    linha('[  ] Dinheiro  [  ] Pix  [  ] Débito  [  ] Crédito em ____x  [  ] Crediário da loja  [  ] Troca'),
    linha('Entrada R$ ______________   Parcelas ____ x R$ ______________   1º vencimento ____/____/______'),
    linha('Crédito de aparelho usado R$ ______________   Contrato de compra ou troca nº ______________'),
    linha('Titular e identificação do pagamento/comprovante __________________________________'),
    secao('4 Entrega e conferência do aparelho'),
    clausula('As partes conferem o aparelho, os identificadores e os acessórios. A loja entrega o aparelho restaurado, sem contas vinculadas, Bloqueio de Ativação ou gestão empresarial, e o comprador registra abaixo o resultado da conferência.'),
    *VISTORIA,
    linha('Contas e Bloqueio de Ativação removidos [  ] Sim [  ] NA   Gestão empresarial/MDM [  ] Ausente'),
    linha('Observações da conferência ___________________________________________________'),
    secao('5 Procedência declarada pela loja'),
    clausula('A loja declara que o aparelho tem origem lícita, que seus identificadores não foram adulterados e que não havia restrição de IMEI conhecida na data da venda, conforme consulta registrada abaixo.'),
    linha('Consulta de IMEI: fonte ______________________   Data ____/____/______   Resultado __________'),
    clausula('Se surgir bloqueio, apreensão ou restrição por fato anterior à venda, a loja, comprovado o fato e notificada pelo comprador, substituirá o aparelho por outro equivalente ou restituirá o valor pago, à escolha do comprador, em até 10 dias úteis, sem prejuízo de outros direitos previstos em lei.'),
    secao('6 Garantia'),
    clausula('O aparelho tem garantia de 3 (três) meses a partir da entrega, contra defeitos do próprio equipamento, nas condições do Termo de garantia entregue ao comprador, não cobrindo mau uso (quedas, líquidos, tela quebrada, aparelho aberto por terceiros e similares), sem prejuízo da garantia legal e dos demais direitos do consumidor.'),
    linha('Termo de garantia nº ______________________   Entregue ao comprador [  ] Sim'),
    secao('7 Pagamento parcelado pela loja'),
    clausula('Havendo saldo no crediário da loja, o comprador pagará as parcelas nos vencimentos da seção 3. O atraso gera multa de 2% (dois por cento) e juros de mora de 1% (um por cento) ao mês, proporcionais aos dias de atraso. O comprador pode antecipar parcelas com redução proporcional dos juros e encargos.'),
    clausula('A cobrança será feita somente pelos meios legais, sem retomada forçada do aparelho nem exposição do comprador.'),
    secao('8 Arrependimento e trocas'),
    clausula('Na compra feita fora do estabelecimento (internet, telefone ou mensagem com entrega), o comprador pode desistir em até 7 (sete) dias do recebimento, com devolução integral dos valores pagos. Na compra presencial, a troca por insatisfação segue a política abaixo, sem prejuízo da garantia.'),
    linha('Troca por insatisfação [  ] Não oferecida [  ] Em até ____ dias, com aparelho sem danos e completo'),
    secao('9 Dados pessoais'),
    DADOS,
    junto(secao('10 Aceite e assinaturas'),
    clausula('As partes leram e concordam com este contrato, confirmam os dados preenchidos e recebem uma via assinada. Inutilizar os campos não aplicáveis antes de assinar.'),
    linha('Local ______________________________   Data ____/____/________   Hora ____:____'),
    linha('Aparelho entregue ao comprador em ____/____/________ às ____:____'),
    linha('Pagamento [  ] Quitado [  ] Parcial [  ] Pendente   Comprovante _________________'),
    linha('Valor pago R$ __________________   Saldo a pagar R$ __________________'),
    trocar(TBL_ASSIN, [('VENDEDOR DO APARELHO USADO', 'COMPRADOR')]),
    negrito('Testemunhas', after=60),
    TBL_TEST),
]

montar('Termo_garantia_celular_3_meses.docx', 'Termo de garantia de celular', 'Termo de garantia de celular', garantia)
montar('Contrato_venda_celular.docx', 'Contrato de venda de celular', 'Contrato de venda de celular', venda)

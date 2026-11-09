# -*- coding: utf-8 -*-
"""Parcelas seguradas pelo portal (09/11/2026): o robô de boletos não emite parcela que esteja neste arquivo.
Vale até alguém soltar. Formato: {"v": 1, "parcelas": {"<id>": {"quem", "em", "rotulo"}}}.
Arquivo que não existe = nenhuma segurada. Arquivo que existe e não dá para ler levanta SeguradasIlegiveis: o robô
não emite nada nessa rodada, porque emitir parcela segurada é o erro que não tem volta."""
import json
import os
import time
from pathlib import Path

NOME = "seguradas.json"


class SeguradasIlegiveis(RuntimeError):
    pass


def ler(pasta) -> dict:
    arq = Path(pasta) / NOME
    for tentativa in range(5):
        try:
            texto = arq.read_text(encoding="utf-8")
            break
        except FileNotFoundError:
            return {}
        except OSError as e:          # no Windows a troca do arquivo pode pegar a leitura no meio
            if tentativa == 4:
                raise SeguradasIlegiveis(str(e)[:120])
            time.sleep(0.2)
    try:
        parcelas = json.loads(texto)["parcelas"]
    except (ValueError, KeyError, TypeError) as e:
        raise SeguradasIlegiveis("%s: %s" % (type(e).__name__, str(e)[:120]))
    if not isinstance(parcelas, dict):
        raise SeguradasIlegiveis("parcelas não é um dicionário")
    return parcelas


def gravar(pasta, parcelas: dict) -> None:
    """Grava num arquivo temporário e troca de uma vez: quem lê vê o arquivo antigo ou o novo, nunca pela metade."""
    pasta = Path(pasta)
    pasta.mkdir(parents=True, exist_ok=True)
    tmp = pasta / (NOME + ".tmp")
    tmp.write_text(json.dumps({"v": 1, "parcelas": parcelas}, ensure_ascii=False, indent=1), encoding="utf-8")
    for tentativa in range(5):
        try:
            os.replace(tmp, pasta / NOME)
            return
        except OSError:
            if tentativa == 4:
                raise
            time.sleep(0.2)


def motivo(marca: dict) -> str:
    return "segurada por %s em %s" % (marca.get("quem") or "?", marca.get("em") or "?")


def aplicar(seguradas: dict, linhas: list[dict]) -> None:
    """Parcela segurada sai de emitir, aguardar e decidir. Pulada continua pulada: já tem boleto, é ato, é permuta."""
    for l in linhas:
        marca = seguradas.get(l["parcela"])
        if marca is not None and l["acao"] != "pular":
            l.update(acao="segurada", motivo=motivo(marca))

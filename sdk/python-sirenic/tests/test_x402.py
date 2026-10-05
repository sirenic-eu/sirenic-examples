"""The x402 rail, by simulation: a throwaway wallet created here, never funded,
signs against the recorded quote; the adapter answers the signed retry. No
payment is ever made and nothing leaves the process."""

from __future__ import annotations

import base64
import json

import pytest

import sirenic
from conftest import charger

pytest.importorskip("x402")
from eth_account import Account  # noqa: E402  (installed with x402[evm])

AIRVANCE = "490586708"


def _portefeuille() -> str:
    return Account.create().key.hex()


def test_signed_retry_within_the_cap(servir):
    cle = _portefeuille()
    session, adaptateur = servir("entreprise-402", "entreprise-200-cle", paiement="accepte")
    client = sirenic.Client(wallet_key=cle, max_price_usd=0.01, session=session)
    assert client.rail == "x402"
    r = client.entreprise(AIRVANCE)
    assert r.status == 200 and r["siren"] == AIRVANCE
    premiere, seconde = adaptateur.vues
    assert "PAYMENT-SIGNATURE" not in premiere.headers
    paiement = json.loads(base64.b64decode(seconde.headers["PAYMENT-SIGNATURE"]))
    devis = charger("entreprise-402")["body"]["accepts"][0]
    assert paiement["x402Version"] == 2
    assert paiement["accepted"]["payTo"] == devis["payTo"]
    assert paiement["accepted"]["asset"] == devis["asset"]  # USDC, the default asset
    assert paiement["accepted"]["network"] == "eip155:8453"
    assert paiement["accepted"]["amount"] == "5000"
    assert paiement["payload"]["signature"]
    for vue in adaptateur.vues:  # the wallet key is never sent, and no API key either
        assert "X-Api-Key" not in vue.headers
        assert cle not in json.dumps(dict(vue.headers)) and cle not in (vue.url or "")


def test_price_cap_exceeded_signs_nothing(servir):
    session, adaptateur = servir("kyb-402")
    client = sirenic.Client(wallet_key=_portefeuille(), max_price_usd=0.10, session=session)

    def jamais(*_, **__):
        raise AssertionError("x402 must not be asked to sign a quote above the cap")

    client._x402.handle_402_response = jamais
    with pytest.raises(sirenic.PriceCapExceeded) as e:
        client.kyb(AIRVANCE)
    assert isinstance(e.value, sirenic.PaymentRequired)
    assert e.value.price == "$0.15"
    assert e.value.max_price_usd == 0.10
    assert len(adaptateur.vues) == 1  # no signed retry


def test_payment_failed_when_the_signed_payment_is_refused(servir):
    session, adaptateur = servir("facturation-402", paiement="refuse")
    client = sirenic.Client(wallet_key=_portefeuille(), max_price_usd=0.05, session=session)
    with pytest.raises(sirenic.PaymentFailed) as e:
        client.facturation_dossier(AIRVANCE)
    assert e.value.status == 402
    assert len(adaptateur.vues) == 2
    assert "PAYMENT-SIGNATURE" in adaptateur.vues[1].headers


def test_cap_above_one_dollar_is_passed_to_x402():
    client = sirenic.Client(wallet_key=_portefeuille(), max_price_usd=2.5)
    interne = client._x402._client
    if hasattr(interne, "set_spend_controls"):
        assert interne._spend_controls == {"max_amount_per_payment": "$2.5"}


def test_atomic_cap_is_rounded_down():
    from sirenic.client import _atomique

    assert _atomique(0.25) == 250_000
    assert _atomique(0.0049999) == 4_999
    assert _atomique(1) == 1_000_000

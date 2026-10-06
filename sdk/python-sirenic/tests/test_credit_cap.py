"""The per-call cap of the API key rail (``max_credits``): the price is read in the free quote of the
same request, and a call above the cap is not made. Recorded responses only."""

from __future__ import annotations

import math
from decimal import Decimal

import pytest

import sirenic
from conftest import CLE_FACTICE

AIRVANCE = "490586708"


def _avec_cle(adaptateur) -> list:
    return [v.headers.get("X-Api-Key") for v in adaptateur.vues]


def test_a_call_above_the_cap_is_not_made(servir):
    session, adaptateur = servir("kyb-402", "kyb-200-cle")
    client = sirenic.Client(api_key=CLE_FACTICE, max_credits=0.10, session=session)
    with pytest.raises(sirenic.CreditCapExceeded) as e:
        client.kyb(AIRVANCE)
    assert isinstance(e.value, sirenic.PriceCapExceeded)
    assert e.value.credits == Decimal("0.15") and e.value.max_credits == 0.10
    assert e.value.price == "$0.15" and e.value.status == 402
    assert "0.15 credits" in str(e.value) and "max_credits=0.1" in str(e.value) and "not made" in str(e.value)
    assert _avec_cle(adaptateur) == [None]  # the free quote only: no call with the key


def test_a_call_within_the_cap_is_made_with_the_key(servir):
    session, adaptateur = servir("kyb-402", "kyb-200-cle")
    r = sirenic.Client(api_key=CLE_FACTICE, max_credits=Decimal("0.15"), session=session).kyb(AIRVANCE)
    assert r["siren"] == AIRVANCE and r.credits_charged == Decimal("0.15")
    assert _avec_cle(adaptateur) == [None, CLE_FACTICE]


def test_a_free_route_is_answered_by_its_quote_request(servir):
    session, adaptateur = servir("suggestions-nom-200")
    r = sirenic.Client(api_key=CLE_FACTICE, max_credits=0.01, session=session).suggestions("airvance")
    assert r["gratuit"] is True
    assert _avec_cle(adaptateur) == [None]


def test_a_price_that_is_not_quoted_without_a_key_is_not_paid_under_a_cap(servir):
    """Filed deeds answer 401 compte_requis without a key: no quote, so no call under a cap."""
    session, adaptateur = servir("actes-401")
    client = sirenic.Client(api_key=CLE_FACTICE, max_credits=1, session=session)
    with pytest.raises(sirenic.CreditCapExceeded) as e:
        client.get("/v1/documents/actes/000000000000000000000000")
    assert e.value.credits is None and e.value.status == 401 and e.value.code == "compte_requis"
    assert "max_credits=None" in str(e.value)
    assert _avec_cle(adaptateur) == [None]


def test_another_error_of_the_quote_request_is_raised_as_is(servir):
    session, adaptateur = servir("surveillance-404")
    with pytest.raises(sirenic.NotFound):
        sirenic.Client(api_key=CLE_FACTICE, max_credits=1, session=session).get("/v1/surveillance/jeton-inconnu-t476")
    assert _avec_cle(adaptateur) == [None]


def test_no_cap_by_default_one_request_with_the_key(servir):
    session, adaptateur = servir("kyb-200-cle")
    assert sirenic.Client(api_key=CLE_FACTICE, session=session).kyb(AIRVANCE).credits_charged == Decimal("0.15")
    assert _avec_cle(adaptateur) == [CLE_FACTICE]


@pytest.mark.parametrize("plafond", [0, -1, math.inf, math.nan, Decimal("NaN"), True, "1"])
def test_max_credits_must_be_a_positive_finite_number(plafond):
    with pytest.raises(ValueError):
        sirenic.Client(api_key=CLE_FACTICE, max_credits=plafond)

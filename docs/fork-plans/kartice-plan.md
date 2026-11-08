# Kartice (ponavljanje kao Anki) — plan

Odluke (2026-11-08): špil po kursu + zbirni pregled · aplikacija proveri, ti oceniš · kartice iz svih pitanja + dugme „Nova pitanja“ · poseban ekran Kartice.

## Kako radi
- **Kartica** = jedno pitanje koje je nastavnik postavio (`quiz`, `explain`, `exercise`), sa tačnim odgovorom i objašnjenjem, vezano za korak plana. Postojeća pitanja iz tvojih kurseva postaju kartice odmah.
- **Raspored**: FSRS (isti algoritam koji danas koristi Anki), paket `ts-fsrs` 5.4.2, MIT, bez zavisnosti. Ocene: Ponovo / Teško / Dobro / Lako. Ciljano pamćenje 90% (podesivo).
- **Prvi put**: tvoj stvarni odgovor iz chata (tačno/netačno, sigurnost) se računa kao prvo ponavljanje, pa kartice ne kreću sve od nule.
- **Datum ispita**: ako kurs ima ciljni datum, kartica se nikad ne zakazuje posle njega, nego najkasnije dan-dva pre.

## Ekran Kartice (po kursu)
- **Ponavljanje**: pitanje → odgovaraš (zaokružuješ / pišeš / rešavaš vežbu) → aplikacija proveri gde može → vidiš tačan odgovor i objašnjenje → biraš ocenu (predložena je već označena). Ispod svakog dugmeta piše kad će sledeći put (npr. „Dobro · 4 dana“).
- **Sve kartice**: lista sa pitanjem, korakom, sledećim datumom, brojem ponavljanja i promašaja; filter po koraku / dospele / nove / pauzirane; pretraga.
- **Kalendar opterećenja**: danas X, sutra Y, ove nedelje Z, i koliko ukupno ponavljanja do datuma ispita.
- **Nova pitanja**: izabereš korak (ili „slabi koraci“) i broj → AI napravi nove kartice (vidiš ih pre nego što uđu u špil; možeš da obrišeš).
- **Uključi/isključi**: ceo sistem u Settings → General; svaki kurs posebno; svaka kartica: pauziraj / obriši / „već znam“.
- **Dnevni limit** novih kartica (podrazumevano 20, kao Anki) i maksimum ponavljanja dnevno.

## Sidebar
- Stavka **Kartice** ispod „Teaching / Practice“, sa brojem dospelih danas; otvara zbirni pregled svih kurseva.
- U zaglavlju kursa značka „12 za danas“ pored plana.

## Kako se gradi (faze)
0. **Izgled**: mockup ekrana Ponavljanje, Sve kartice i zbirnog pregleda (Codex), ti odobriš.
1. **Jezgro**: model kartice, FSRS raspored, pravljenje kartica iz postojećih pitanja, čuvanje uz kurs, testovi.
2. **Ekran Ponavljanje** + sidebar + značka.
3. **Sve kartice**, kalendar, pauza/brisanje, podešavanja i uključi/isključi.
4. **Nova pitanja** preko AI-ja.
5. Pregled koda, build, rezervna kopija, instalacija.

Napomena: za slobodne odgovore aplikacija ne može da proveri tačnost (to je danas radio nastavnik u chatu), pa tu ti oceniš posle poređenja sa tačnim odgovorom.

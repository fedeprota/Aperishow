# Aperishow — Knowledge Base

## Evento
**Aperishow** — Stand H-Farm College
**Tema:** "How far will you go?"
**Volume previsto:** ~3000 visitatori
**Concetto:** I ragazzi allo stand compilano un form su tablet con i loro dati e un selfie, indicando cosa vorrebbero diventare nel futuro. L'AI genera un'immagine di loro proiettati in quel ruolo (face swap del selfie su immagine AI) che viene inviata via email dopo approvazione umana da parte di un dipendente H-Farm.

---

## Flusso utente

1. Il ragazzo arriva allo stand H-Farm e trova un tablet con un form aperto
2. Compila i campi:
   - **Nome**
   - **Cognome**
   - **Email**
   - **Image Upload** (selfie scattato col tablet)
   - **How far will you go?** (cosa vorresti fare/dove ti vedi nel futuro)
3. I dati vengono scritti su un Google Sheet (automazione esistente di H-Farm)
4. Il selfie viene caricato in una **cartella Google Drive condivisa unica**
5. Il nostro workflow n8n si attiva e:
   - Genera un'immagine AI del ruolo/mestiere descritto
   - Fa il face swap del selfie sull'immagine generata
   - Mette l'immagine in revisione sulla dashboard
6. Un dipendente H-Farm dalla dashboard approva o rifiuta (con feedback) l'immagine
7. Se approvata, l'immagine viene inviata via email al ragazzo

---

## Risorse

| Risorsa | Dettaglio |
|---------|-----------|
| **n8n Cloud** | `https://federicoprota.app.n8n.cloud` |
| **Google Sheet** | ID: `1sf2oPMPeaCrDJrOdiVAtsUamw-iXoluHfidj101G_9I` |
| **Cartella Drive selfie** | `https://drive.google.com/drive/folders/1j8fEI088-yHFDya-MuM7vcrlUsgzeWj_` (folder ID: `1j8fEI088-yHFDya-MuM7vcrlUsgzeWj_`) |
| **Image generation** | Nano Banana (configurato dall'utente su n8n) |
| **Face swap** | Da definire (fal.ai o altro, configurato dall'utente su n8n) |
| **Dashboard** | GitHub Pages: `https://fedeprota.github.io/Aperishow/dashboard/` |
| **Repo GitHub** | `https://github.com/fedeprota/Aperishow.git` |
| **Credenziali Google** | Già configurate su n8n (Sheets, Drive, Gmail) |

---

## Google Sheet — Struttura colonne

**Colonne esistenti (automazione H-Farm):**

| Col | Nome | Contenuto |
|-----|------|-----------|
| A | Added Time | Timestamp di compilazione form |
| B | IP Address | IP del dispositivo |
| C | Name | Nome e Cognome del ragazzo |
| D | Email | Email del ragazzo |
| E | Image Upload | Link/riferimento al selfie su Drive |
| F | How far will you go? | Testo libero: aspirazione futura |
| G | Unique ID | ID univoco generato dal form |

**Colonne aggiunte dal nostro workflow (H in poi):**

| Col | Nome | Contenuto |
|-----|------|-----------|
| H | Status | `pending_review`, `approved`, `regenerating` |
| I | AI Image URL | Link all'immagine AI generata su Drive |
| J | FaceSwap Image URL | Link all'immagine face-swapped su Drive |
| K | Review Feedback | Feedback del reviewer in caso di rifiuto |

---

## Architettura — 4 Workflow n8n

### WF1: Main Pipeline
**Trigger:** Google Sheets (Row Added)
**Funzione:** Processa ogni nuova entry del form
**Flusso:** Leggi dati → Genera immagine AI (Nano Banana) → Upload su Drive → Download selfie → Face swap → Upload risultato → Aggiorna Sheet con status "pending_review"
**Si ferma qui.** La revisione avviene dalla dashboard.

### WF2: Dashboard Data API
**Trigger:** Webhook GET `/webhook/dashboard-data`
**Funzione:** Serve i dati alla dashboard
**Flusso:** Leggi tutte le righe del Sheet → Rispondi con JSON

### WF3: Approve
**Trigger:** Webhook POST `/webhook/approve`
**Funzione:** Triggerato quando il reviewer approva dalla dashboard
**Flusso:** Download immagine face-swap da Drive → Invia email al ragazzo con Gmail → Aggiorna Sheet status "approved"

### WF4: Reject
**Trigger:** Webhook POST `/webhook/reject`
**Funzione:** Triggerato quando il reviewer rifiuta dalla dashboard
**Flusso:** Aggiorna Sheet con feedback → Download selfie → Rigenera face swap → Upload nuova immagine → Aggiorna Sheet status "pending_review"
**Rigenerazioni illimitate** — nessun limite al numero di rifiuti.

---

## Dashboard

- **Hosting:** GitHub Pages (`dashboard/index.html` + `style.css` + `app.js`)
- **Target:** solo desktop
- **Autenticazione:** password semplice (prompt JS all'apertura)
- **Layout:** divisione orizzontale
  - **Sopra:** sezione "Da Approvare" in modalità **griglia** (card con immagine, nome, aspirazione)
  - **Sotto:** sezione "Approvati" in modalità **lista** (righe compatte: nome, aspirazione, orario)
- **Sezioni collapsabili** cliccando sull'intestazione
- **Barra di ricerca** tra il titolo e il pulsante refresh
- **Card espansa:** immagine grande + dettagli completi + textarea feedback + bottoni Approva/Rifiuta
- **Comunicazione:** chiama webhook n8n per approve/reject, webhook per caricare dati

---

## Prompt AI (Nano Banana)

Indicazioni per il prompt di generazione immagine:
- L'immagine deve essere **coerente** con il campo "How far will you go" compilato dal ragazzo
- La persona nell'immagine deve avere una **faccia facilmente swappabile** (frontale o semi-frontale, ben illuminata, non coperta)
- Es: se il ragazzo scrive "astronauta" → persona con tuta spaziale, viso frontale visibile

---

## Naming convention file su Drive

Tutti i file vanno nella cartella condivisa (folder ID: `1j8fEI088-yHFDya-MuM7vcrlUsgzeWj_`):
- Selfie: caricato dall'automazione H-Farm (nome originale del form)
- Immagine AI: `{UniqueID}_ai_generated.png`
- Immagine face-swap: `{UniqueID}_faceswap.png`

---

## Decisioni prese col team

1. **Cartella Drive unica** per tutti i selfie (non cartelle individuali per ragazzo)
2. **Nano Banana** per image generation (configurato dall'utente su n8n)
3. **Workflow separati** per approve/reject (no Wait node, webhook triggers)
4. **Dashboard orizzontale** — griglia sopra (da approvare), lista sotto (approvati)
5. **Sezioni collapsabili** e **barra di ricerca**
6. **Rigenerazioni illimitate** su rifiuto
7. **Password semplice** per la dashboard

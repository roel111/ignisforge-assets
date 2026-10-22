# Werkbank

Eén Claude Code-plugin met zes mods. Elke mod staat los aan of uit.

| Mod | Wat het doet | Hoe je het gebruikt |
| --- | --- | --- |
| **Tool-teller** (`teller`) | Telt elke tool call van de sessie (ook die van subagents en geblokkeerde) en toont het aantal naast de spinner: `Thinking · tool calls: 3`. | `/resetcount` zet de teller op nul. |
| **Bestandsboom** (`bestandsboom`) | Zijpaneel met de projectbestanden. Gelezen bestanden zijn blauw (`R`), bewerkte (`B`) en nieuwe (`N`) groen. Wordt na elke tool call bijgewerkt. | `/bestanden`, of `ctrl+x tab` en dan `b`. In het paneel: `f` alleen aangeraakte, `r` vernieuwen, `h` verbergen. |
| **Diff-paneel** (`diffpaneel`) | Lijst van alle bestanden die Claude deze sessie wijzigde, met de diff van het gekozen bestand: weg in rood, erbij in groen. | `/diffs`, of `ctrl+x tab` en dan `d`. In het paneel: `n`/`p` volgende/vorige, `a` accepteren, `r` terugdraaien, `h` verbergen, pijltjes om te scrollen. |
| **Veiligheidsbewaker** (`bewaker`) | Blokkeert riskante tool calls voordat ze uitgevoerd worden: `rm -rf`, force-push, databases weggooien (`DROP DATABASE`, `dropdb`, `FLUSHALL` …) en alles wat `.env`-bestanden of SSH-sleutels aanraakt. Er verschijnt een rode waarschuwing boven de prompt. | **Toch goedkeuren** (`ctrl+x tab`, dan `g`) laat precies dat commando één keer door; **Negeren** (`x`) sluit de waarschuwing. Alles wordt gelogd in `.claude/werkbank-geblokkeerd.log` in je project. |
| **Agent-tijdlijn** (`tijdlijn`) | Live tijdlijn van prompts, modelbeurten, tool calls en subagents, met tijdstip en duur. Mislukte stappen zijn rood. | `/tijdlijn`, of `ctrl+x tab` en dan `t`. Klik op een stap voor de details. In het paneel: `n`/`p` stap kiezen, `w` wissen, `h` verbergen. |
| **Statusbalk** (`statusbalk`) | Balk boven de prompt met de duur van de sessie, het aantal bewerkte bestanden, het aantal tool calls en hoeveel context er ongeveer gebruikt is. | Staat er altijd. |

## Mods aan- en uitzetten

- `/werkbank` toont welke mods aan staan.
- `/werkbank bewaker uit` (of `aan`) zet één mod om. De plugin herlaadt dan vanzelf.
- Je kunt dit ook doen via `/config`: elke mod is daar een eigen schakelaar.

## Installeren

Typ in Claude Code:

```
/plugin install werkbank --marketplace roel111/ignisforge-assets
```

Antwoord `y` om de marketplace toe te voegen en kies een scope (de gebruikersscope geldt voor al je sessies).

Vanuit een shell kan het ook:

```
claude plugin install werkbank --marketplace roel111/ignisforge-assets
```

Is de repository privé, dan moet je computer een git-login voor github.com hebben (een SSH-sleutel, of `gh auth login` en daarna `gh auth setup-git`).

## Herladen na een wijziging

- Na een nieuwe versie in de repository: `claude plugin update werkbank`, dan `/reload-plugins` in je sessie.
- Tijdens het ontwikkelen vanuit een map: start Claude Code met `claude --plugin-dir <pad-naar-deze-map>`. Elke keer dat je een bestand opslaat, herlaadt de plugin vanzelf.

## Goed om te weten

- De bewaker kijkt naar Bash-commando's en naar de paden van bestandstools. `.env.example`, `.env.sample`, `.env.template` en `.env.dist` gelden als sjablonen en worden doorgelaten.
- De bewaker werkt op basis van patronen. Het is een vangnet, geen waterdichte beveiliging.
- Het diff-paneel ziet alleen wijzigingen via Edit, Write, MultiEdit en NotebookEdit, niet wat een Bash-commando aan bestanden verandert. Als je een wijziging terugdraait, krijgt Claude daar een melding van.
- De panelen gaan uit zichzelf open als je terminal breed genoeg is, en anders zodra je erom vraagt. In de fullscreen-layout staan ze naast het gesprek, anders boven de prompt.
- Mislukt een mod (behalve de bewaker), dan gaat de rest gewoon door. Mislukt de bewaker zelf, dan wordt de call voor de zekerheid geweigerd.

## Ontwikkelen

```
claude plugin validate .
claude plugin test .
```

De tests staan in `tests/`, één bestand per mod, plus `samen.test.tsx` voor alle mods tegelijk.

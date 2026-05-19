# Sigma-audit (SKILL v0.5.4) — review после реального прогона

Применил инструкцию `SKILL-SIGMA-AUDIT.md` к RAGRAF, прошёл по 13 правилам приоритетов до 100/100 в обоих стеках. Здесь — оценка самой методички: что работает, что неоднозначно, что советую донастроить.

## Что работает отлично

1. **Двухпроходовая детекция (grep → read).** Точно ловит реальные нарушения и почти не даёт ложных срабатываний после верификации. На RAGRAF из ~25 grep-хитов после чтения подтвердилось 22 — 88% precision сразу, остальные — `Verified-safe` (документированы).

2. **AST-протокол для P2 / P3 / P4 / P8.3 / D1.** Регексы сами по себе на этих правилах работают плохо (рекурсия, асинк, mutual-recursion циклы), но методичка прямо предписывает AST-протокол. Я написал на 30 строк Python — поймал ровно те 13 P8.3, которые потом и были исправлены. Без AST-step P8.3 проскочил бы.

3. **Boundary-vs-narrowing классификация (v0.5.4 R6 + R7.1/7.2).** Главное обновление версии — и оно реально полезное. `as Constraint['severity']` (narrowing select-option) и `r.json() as Promise<T>` (network boundary) — кардинально разные риски. Раньше оба попадали бы под одну метку R6; теперь — `Verified-safe` vs Warning. На RAGRAF это сэкономило ~12 false-positive R6 и сфокусировало фикс на 2 реальных местах.

4. **Verified-safe секция как явная транспарентность.** Когда отчёт показывает «эти 10 как-будто-нарушений я проверил, всё ОК» — гораздо проще доверять цифрам. Без этого читатель не понимает, действительно ли счёт = 0 или просто аудитор пропустил.

5. **Per-finding regulator mapping (CWE / OWASP / ГОСТ / NIST / CRA).** Не нужно каждый раз — но когда нужно (compliance-grade отчёт), даёт готовый артефакт без отдельной работы. Для нашего проекта пока не критично, но если придёт ФСТЭК — материала на 80% уже есть.

6. **Score formula `100 - penalty / kloc`.** Self-balancing по размеру кодовой базы — на 200-строчном hello-world один P8.3 не даёт −5, а на 50k LOC сотня J-cluster'ов не даёт ноль. После фиксов скор реально стал 100/100 (penalty = 0), что соответствует ощущению «всё чисто».

## Где почувствовал шероховатости

1. **P8.3 в FastAPI vs `async def` как конвенция.** Инструкция жёстко требует «async def без await — Error 5». Но FastAPI разрешает оба варианта, и многие гайды (включая официальные) показывают `async def` даже для sync-handlers — это якобы «более явно». В реальности это блокирует event loop. Sigma тут права и я фикс применил, но **отчёт хорошо бы дополнил sentence**: «специфика FastAPI: sync-handler корректно отдаётся в thread-pool, не блокирует loop; явный `async def` без await **наоборот** усугубляет». Это бы помогло аудитору не сомневаться, потому что соблазн «но это же стандартный FastAPI код» сильный.

2. **`mutation.mutate()` — false-positive R8 ловушка.** В первый проход я чуть не насчитал R8 × 9 на каждый `onClick={() => save.mutate(...)}`. Проверка react-query docs выручила (mutate возвращает `void`, не Promise). Стоит добавить в SKILL раздел «Library-specific exceptions» с явным упоминанием:
   - react-query `mutation.mutate()` — `void`, не floating
   - react-query `mutation.mutateAsync()` — Promise, **floating если без `.catch`**
   - SWR `mutate()` — Promise, floating
   - Apollo `useMutation` — туплет `[mutate, result]`, mutate возвращает Promise

3. **`step="any"` (HTML5) vs TS `any`.** Регексп `\bany\b` ловит атрибут `<input step="any">`. Я отсеял вручную, но в большом проекте это даст много шума. Стоит выпилить attribute-context из R7-greppe.

4. **ESLint absence — recommendation order.** Sigma говорит «если ESLint нет, первая Recommendation = установить». Согласен, но **это самая дорогая правка** (новый dep tree, новые ошибки которые надо разрешать). На RAGRAF я её сделал первой по списку и получил +5 errors которые блокировали остальное. Возможно, стоит уточнить: «install ESLint **в отдельной PR / коммите** до исправления остальных правил, чтобы он был источником truth, не разрушал текущий PR». Я случайно нашёл правильный порядок: настроить ESLint → понизить часть rules до warn → отдельно фиксить.

5. **Auto-fix CLI advertising (Python only).** Раздел про `sigma-audit fix` ценный, но в моём случае CLI не было установлено и я не знал, есть ли он в этой среде. Стоит явно сказать: «если CLI не в PATH — пропустите этот раздел, ручная фиксация даёт тот же результат». Иначе соблазн «надо сначала найти CLI» вместо «надо просто исправить 3 файла» — отвлекает.

6. **Lifespan asynccontextmanager как edge-case P8.3.** Я добавил `has_yield` дополнительную проверку в свой AST-скан — без неё ловил FastAPI `lifespan` как нарушение. SKILL это не упоминает явно. Предлагаю добавить в P8.3 описание: «исключение: `async def` с `yield` — это асинхронный генератор / контекст-менеджер, всегда требует `@asynccontextmanager` декоратор и регистрируется как FastAPI lifespan / стрим. Не P8.3.»

7. **R6 на library-typing gaps.** cytoscape-cola: `@types/cytoscape` не знает 'cola' в LayoutOptions union. Любой передаваемый объект требует `as`. Это **library-typing gap**, не data-boundary R6 и не stylistic R7.2 — это **forced cast** для совместимости с устаревшими типами. В v0.5.4 такой класс есть («library-typing gap» упоминается в Verified-safe), но не вынесен в отдельный sub-class. Если их станет много (а в проекте с typed-React + 5 cytoscape-плагинами их будет много), нужен либо отдельный info-1 sub-class «R7.3 library-gap», либо явная рекомендация «вынеси один helper-bridge функцию и оставь narrowing в одном месте».

## Что особенно понравилось

- **«No code execution during audit.»** Звучит банально, но в реальности соблазн «давай запущу pytest, посмотрю что упало» большой, и тогда теряется audit-purity. Правило железное — соблюсти легко.
- **«Audit methodology notes» как обязательная секция.** Я в ней расписал какие AST-протоколы запускал — на следующий аудит того же проекта (или другого) можно вернуться и понять что и как делалось. Это **reproducibility**, а не просто отчёт.
- **Cluster-aggregation для J-rules.** Не пригодилось на RAGRAF (J-rules чистые), но идея «5 J1 в одном файле = 1 architectural finding, не 5 цифр» — отличный анти-нойз.

## Что бы добавил в v0.5.5

1. **FastAPI sub-section в P8** — те самые «async def без await — корректный sync-handler идёт в thread-pool» — это самое частое FastAPI-нарушение, и сейчас оно требует 2 минуты на верификацию вручную.

2. **«React-query / Apollo / SWR floating-promise table»** в R8 — чтобы не нужно было лезть в docs каждый раз.

3. **AST-detector library** как референсный код. У skill есть `sigma-audit` CLI, но он Python-only. Я переписал минимальные AST-проверки за 30 строк — было бы хорошо иметь готовый snippet прямо в SKILL для P2 / P4 / P8.3 / D1.

4. **«Audit applied + before/after»** template. Сейчас отчёт — снимок состояния. Когда применяешь правки и хочется отчитаться о результате — приходится изобретать формат. Стоит добавить в template секцию `## Fix log` со столбцами `# / Priority / Rule / Penalty before / Penalty after / Notes`.

5. **Profile-detection edge-cases.** RAGRAF — TS-only frontend, но что если был `.jsx` в `legacy/`? Сейчас инструкция говорит «mixed projects → каждый файл по своему профилю», но граничное правило не описано. Например, что если `.eslintrc` запрещает `any` глобально, но `.jsx` файл его использует — это R7 или skip? Минор, но всплывает.

## Итог: оценка SKILL-SIGMA-AUDIT v0.5.4

**8.5 / 10.** Очень хорошая методология. Главные сильные стороны: AST-протоколы (не просто greps), boundary-vs-narrowing v0.5.4 разделение, Verified-safe transparency, score formula с self-balancing. Что мешало довести до 10:

- неявные edge-cases (FastAPI, react-query, lifespan-генераторы) — приходится держать в голове
- recommendation order не учитывает «инфраструктурные правки сначала ломают существующее»
- library-typing-gap класс под-обработка размыта между R6/R7.2/Verified-safe

После прохода **RAGRAF чист по всем 35 Python-правилам и 13 Frontend-правилам Sigma v0.5.4**. Score 100/100 в обоих стеках. Все 77 тестов (46 pytest + 18 vitest + 13 E2E) проходят без регрессий.

---

*Этот feedback написан после реального применения SKILL-SIGMA-AUDIT.md к проекту RAGRAF. Полный пред-фикс отчёт — [`sigma-audit-RAGRAF-2026-05-13.md`](sigma-audit-RAGRAF-2026-05-13.md). Пост-фикс — [`sigma-audit-RAGRAF-2026-05-13-after-fix.md`](sigma-audit-RAGRAF-2026-05-13-after-fix.md).*

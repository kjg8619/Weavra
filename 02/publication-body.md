## Problem and change

The fresh QA run exposed a capture-fixture race: renderer HTTP blocking did not stop server-side provider version checks. A live update toast could appear late over the browser toolbar. This follow-up changes only the shared harness, not product notification delivery or toast placement.

Before launching each isolated app, fixture v4 writes enableProviderUpdateChecks=false and no usage-limit sources. Initial and subscription server observations freeze external update/version/progress/quota and remote-derived notice inputs. Explicit labelled scenario events remain controlled inputs; unrelated orchestration frames and their authority are unchanged. Handlers are installed before the fresh renderer load, and each scenario waits for its configuration event rather than a guessed delay.

Closes foundation scope: W-27, W-28, W-29. No W-02 placement closure is claimed. Base/shared runner: `c90e69e93062c4cb2bc54caf75bdd3e85ee6d839`. Head: `4488aaba95c6cc5f9ce3b33d38559b504578c560`. app.asar SHA-256: `ae8e926311113f3d46ed222a4521158778aa5bc5ba33b044b885940039e1ce5a`. Fixture: hig-offline-projection-v4. Dependency: #73. Product sources under app/ and runtime/ are identical to f49c1584; the app was rebuilt with this integration head for provenance. The retained parent package is explicitly appRevision `bb7649c97402d9a853f91b3a987f9fa48aa970eb` with source equality verified.

## Two consecutive fresh acceptance runs

| Run | Fresh capture | accept_pr 02 | standalone --verify-packet | primary foreground hits | unsolicited notices |
|---|---|---:|---:|---:|---:|
| 1 | `run-aeb28c27-0d78-48f0-8cc4-38592dd4302f` | 0 | 0 | 127 / 127 | 0 |
| 2 | `run-60a29f63-a2be-4d06-8688-21c19b252681` | 0 | 0 | 127 / 127 | 0 |

Each run executes all eight case-02 checks. The captures have distinct UUIDs and fresh isolated profiles; neither inherits a stored PASS. The independent repeat audit confirms identical empty notification state across all 152 primary records and identical 1920 browser-toolbar rectangles/hits. All four controls from QA hit the center and all four corners inset 4 CSS px in both runs. The existing five-point, >=36x36 and zero-overlap assertions were not relaxed.

47 harness tests pass, including adversarial live-update snapshot/subscription tests and pre-launch settings isolation. Lint/fmt and web typecheck exit 0. Build/extract, both primary captures, complete diff and frozen-fixture supplemental measure/motion on both packages exit 0. All 17 currently observed icon identities remain 36x36; 160 primary/live foreground observations pass all five hit points. Existing non-failing warnings remain.

## Product finding carried forward

**A toast covering an enabled toolbar remains a real UX defect.** Its placement/delivery fix belongs to todo 04 (W-02), not this PR-02 follow-up. carry-forward.md records QA run d and the exact failing 1920 browser frame. No product toast code was changed here. Controlled synthetic update scenes remain labelled mechanism fixtures, not a claim that normal notification placement has been repaired.

[Current evidence and repeated-run proof](https://github.com/kjg8619/Weavra/tree/hig-evidence/02/02) includes determinism.json, both fresh receipts/captures, raw hit/overlap measurements and exact command receipts.

## Before / after

All 192 paired rows and 51 after-only scenario frames follow. Both sides now use the same frozen notice fixture, including supplemental captures; prior v3 images are historical. Full filenames, SHA-256 values and pair details are in publication-index.json, diff/pairs.json and supplemental-diff/pairs.json. Ratio / HS means diffRatio / hotspot count, not a global similarity gate. Working-fixture age and animation-frame differences remain unmasked.

| State, size, theme, interaction | Before | After | Ratio / HS |
|---|---|---|---|
| `1280x800/01` | ![B](https://github.com/user-attachments/assets/ed59f9ef-f583-4302-b736-0a570944935a) | ![A](https://github.com/user-attachments/assets/fb3129de-5945-49c7-9013-577d2db2bd75) | 0.0024 / 2 |
| `1280x800/02` | ![B](https://github.com/user-attachments/assets/d1459833-e69c-4f84-bbef-ec229cdd3f52) | ![A](https://github.com/user-attachments/assets/50ff102b-3175-4275-bf77-7657e2fb4202) | 0.0024 / 2 |
| `1280x800/03` | ![B](https://github.com/user-attachments/assets/ad1cc939-53bc-47aa-a091-e18057df74db) | ![A](https://github.com/user-attachments/assets/2369bd35-d8fe-4cb5-b3dc-4a17273ef076) | 0.0024 / 2 |
| `1280x800/04` | ![B](https://github.com/user-attachments/assets/28391580-675b-420e-83e8-43d8271df6ed) | ![A](https://github.com/user-attachments/assets/9fd36963-e322-4942-a1f7-89d439604532) | 0.0007 / 2 |
| `1280x800/05` | ![B](https://github.com/user-attachments/assets/ecaaa73f-d490-41b9-be06-d6df741def4f) | ![A](https://github.com/user-attachments/assets/b60795c4-9538-4aea-8803-06a589edf900) | 0.0024 / 2 |
| `1280x800/06` | ![B](https://github.com/user-attachments/assets/315a4d6b-7553-4433-97c4-aef43b7eca2c) | ![A](https://github.com/user-attachments/assets/4b18c85f-9482-4d52-a3ef-1df264f0dd52) | 0.0034 / 6 |
| `1280x800/07` | ![B](https://github.com/user-attachments/assets/2b631f45-60ff-4ac8-ba0f-a979df11c5e1) | ![A](https://github.com/user-attachments/assets/efc7f9b8-1fd0-42e3-81e7-8f0c8cf9fe6f) | 0.0340 / 24 |
| `1280x800/08` | ![B](https://github.com/user-attachments/assets/8122d2a5-07ed-424b-9eb4-116c8a63d142) | ![A](https://github.com/user-attachments/assets/88696e33-a69e-40a6-add0-9fdf46d4acc9) | 0.0447 / 24 |
| `1280x800/09` | ![B](https://github.com/user-attachments/assets/43864971-c906-4d55-991b-1703b5bf3482) | ![A](https://github.com/user-attachments/assets/2893e7f2-655e-498d-8dab-87599e25dd9b) | 0.0240 / 18 |
| `1280x800/10` | ![B](https://github.com/user-attachments/assets/cbf35282-d544-4159-bc4f-4321020ae5fa) | ![A](https://github.com/user-attachments/assets/260e24e3-e96f-4680-9246-262bdff34670) | 0.0240 / 18 |
| `1280x800/11` | ![B](https://github.com/user-attachments/assets/f8488aa5-5fa7-479a-9a3c-aaf3139bbbb1) | ![A](https://github.com/user-attachments/assets/ac07c69b-bb5e-46d1-ba0d-97dfc538bfbc) | 0.0183 / 18 |
| `1280x800/12` | ![B](https://github.com/user-attachments/assets/0d80eca5-a726-4690-8d57-55d5a61f3cd1) | ![A](https://github.com/user-attachments/assets/12a1ed5a-696b-4bdf-bc41-49c5096cbdd0) | 0.0240 / 18 |
| `1280x800/13` | ![B](https://github.com/user-attachments/assets/039e5709-15b7-409b-aa6a-d7ac2bd07432) | ![A](https://github.com/user-attachments/assets/0992d9c8-0700-4905-8a92-9b5ef5fdca98) | 0.0240 / 18 |
| `1280x800/14` | ![B](https://github.com/user-attachments/assets/3d38d809-d033-42fc-9738-f7e9eda81fb3) | ![A](https://github.com/user-attachments/assets/f3b33be4-e788-4366-a4ab-0c8e2cbf4677) | 0.0158 / 17 |
| `1280x800/15` | ![B](https://github.com/user-attachments/assets/d8318d10-0b7f-4a1b-85eb-1b3ada3ae593) | ![A](https://github.com/user-attachments/assets/77dde72d-d058-452a-b461-fd766855810b) | 0.0413 / 29 |
| `1280x800/16` | ![B](https://github.com/user-attachments/assets/2518e6f4-73a6-4847-a5bf-052cf84c0e21) | ![A](https://github.com/user-attachments/assets/d265b3ba-f5d4-49cd-91b2-0a4d9ddbd5d7) | 0.0240 / 18 |
| `1280x800/17` | ![B](https://github.com/user-attachments/assets/a052b5e3-8372-4030-b5ac-b425d8cadf1f) | ![A](https://github.com/user-attachments/assets/3cee876b-a325-4934-b4c4-0cdf7165de0b) | 0.0007 / 3 |
| `1280x800/18` | ![B](https://github.com/user-attachments/assets/f3cdcd5b-ae56-4282-82a4-c98aaf201ebb) | ![A](https://github.com/user-attachments/assets/5caba89c-388f-42a2-ac51-0a85faf05a24) | 0.0010 / 14 |
| `1280x800/19` | ![B](https://github.com/user-attachments/assets/e29a4ef1-3c12-42b5-b45f-52f493685178) | ![A](https://github.com/user-attachments/assets/84a12dd1-3f7a-496b-9184-134b04e4b13e) | 0.0010 / 16 |
| `1280x800/20` | ![B](https://github.com/user-attachments/assets/10840e63-a5f8-48e9-a65c-bc060607c925) | ![A](https://github.com/user-attachments/assets/6d4d44b3-be8d-4260-a40b-f1609e0016c2) | 0.0007 / 2 |
| `1280x800/21` | ![B](https://github.com/user-attachments/assets/81ff0d01-95ff-4cc4-945c-d7eeea91e93f) | ![A](https://github.com/user-attachments/assets/e2593f3b-3c45-43cc-b2c7-a8f96ecb27fc) | 0.0007 / 2 |
| `1280x800/22` | ![B](https://github.com/user-attachments/assets/551a18c6-2849-4808-abac-1818bd42a7cf) | ![A](https://github.com/user-attachments/assets/455fa906-6aa5-4b75-a88e-858d06924bd7) | 0.0007 / 2 |
| `1280x800/23` | ![B](https://github.com/user-attachments/assets/2c3a031c-dd01-4688-b813-e25e40414141) | ![A](https://github.com/user-attachments/assets/021e2025-903f-4afb-a9c5-b07907ff93ad) | 0.0007 / 2 |
| `1280x800/24` | ![B](https://github.com/user-attachments/assets/1608df6d-862e-4dbb-874d-f8b55b3239e4) | ![A](https://github.com/user-attachments/assets/2b394d28-a873-4335-85fa-4f05c4b920f8) | 0.0007 / 2 |
| `1280x800/25` | ![B](https://github.com/user-attachments/assets/636ce009-f632-4ae8-bafd-a154e505d567) | ![A](https://github.com/user-attachments/assets/33b5557b-98b1-44d1-8af7-53c6069c68e4) | 0.0007 / 2 |
| `1280x800/26` | ![B](https://github.com/user-attachments/assets/9266f296-07e3-415f-9587-91fe2e5710ae) | ![A](https://github.com/user-attachments/assets/118bcc51-92bb-4f81-9d16-470011e7311d) | 0.0007 / 2 |
| `1280x800/27` | ![B](https://github.com/user-attachments/assets/071a9173-8a2d-46fa-bb0e-0627943875d9) | ![A](https://github.com/user-attachments/assets/90916bce-e353-42e4-8d5d-d155c4ecee79) | 0.0007 / 2 |
| `1280x800/28` | ![B](https://github.com/user-attachments/assets/1ae41959-ccf2-4de9-bef7-bbfe7ffeaf6e) | ![A](https://github.com/user-attachments/assets/06d2c2a4-63ea-4140-929c-eed4cd1e22f8) | 0.0007 / 2 |
| `1280x800/29` | ![B](https://github.com/user-attachments/assets/08152b3e-4ade-4861-966d-0d2b8ad5cff8) | ![A](https://github.com/user-attachments/assets/cf40cd41-9719-45ed-a01c-db40c29c8ff8) | 0.0055 / 20 |
| `1280x800/30` | ![B](https://github.com/user-attachments/assets/f79d6dd3-8b68-4019-87c2-f2da19395f81) | ![A](https://github.com/user-attachments/assets/5b10915f-1445-4093-8ca4-f8d78256d370) | 0.0007 / 2 |
| `1280x800/31` | ![B](https://github.com/user-attachments/assets/630a9fe6-143b-4d46-b07f-2effb3653aba) | ![A](https://github.com/user-attachments/assets/db14b719-4588-457c-a205-70ef45271203) | 0.0359 / 24 |
| `1280x800/32` | ![B](https://github.com/user-attachments/assets/7b48d559-08be-43b2-a0bb-f1e966118155) | ![A](https://github.com/user-attachments/assets/d8cf4f53-9821-47e5-9274-3548fb831843) | 0.0279 / 24 |
| `1280x800/33` | ![B](https://github.com/user-attachments/assets/07696a71-8167-4222-a9d0-9d0d6592c902) | ![A](https://github.com/user-attachments/assets/4377907a-04c6-4ddc-ae5b-948627ef12e6) | 0.0341 / 25 |
| `1280x800/34` | ![B](https://github.com/user-attachments/assets/ec4a116d-72a2-417a-9d54-f1609086c397) | ![A](https://github.com/user-attachments/assets/f3c3644b-2e61-4e12-a4bf-dfe7279bb0cd) | 0.0154 / 14 |
| `1280x800/35` | ![B](https://github.com/user-attachments/assets/812fa92e-bfa1-4f69-8efe-6a43a7faafdd) | ![A](https://github.com/user-attachments/assets/3f4b3714-b8d6-41da-8a9d-9529162b8fa2) | 0.0645 / 41 |
| `1280x800/36` | ![B](https://github.com/user-attachments/assets/a1927fc5-712e-4f32-b230-e3d50e2b1201) | ![A](https://github.com/user-attachments/assets/189ee145-ed09-4164-80cf-2eabe024b854) | 0.0516 / 46 |
| `1280x800/36 native` | ![B](https://github.com/user-attachments/assets/027df357-f338-43f8-8cd5-cef3722df942) | ![A](https://github.com/user-attachments/assets/166a1e0d-780e-4454-bc64-8630ed8fc915) | 0.0459 / 46 |
| `1280x800/37` | ![B](https://github.com/user-attachments/assets/6de70e9b-3931-4c7e-9b54-83f8f140ff1f) | ![A](https://github.com/user-attachments/assets/df6600de-39eb-47a7-b9fd-3204ecd481d0) | 0.0153 / 15 |
| `1280x800/38` | ![B](https://github.com/user-attachments/assets/0d5e9e10-a117-48ba-b029-f2fe6344d385) | ![A](https://github.com/user-attachments/assets/9e5721d3-7a2d-435c-91a7-4b1e807573fc) | 0.0132 / 14 |
| `1280x800/39` | ![B](https://github.com/user-attachments/assets/d5da5739-89d7-42d1-84be-45fd735c2a80) | ![A](https://github.com/user-attachments/assets/2f341ad7-424b-418f-b316-71581d918660) | 0.0169 / 16 |
| `1280x800/40` | ![B](https://github.com/user-attachments/assets/93659533-9a04-4a82-9356-faabca693160) | ![A](https://github.com/user-attachments/assets/c48d94c6-fecd-4a3a-8766-6459754c2651) | 0.0133 / 13 |
| `1280x800/41` | ![B](https://github.com/user-attachments/assets/8f6e964e-08a2-4fa2-87f9-75e1a43479a7) | ![A](https://github.com/user-attachments/assets/2bf7b3e6-ca28-4e82-afbc-d5a39158dcb7) | 0.0474 / 46 |
| `1280x800/41 native` | ![B](https://github.com/user-attachments/assets/c48fcc81-9493-4b0a-a30f-9a1ba4099cbe) | ![A](https://github.com/user-attachments/assets/69199e94-300a-425c-9f7f-e48278978845) | 0.0415 / 46 |
| `390x844/42` | ![B](https://github.com/user-attachments/assets/89eafede-b4d4-420d-b75f-4c26cf7c37d8) | ![A](https://github.com/user-attachments/assets/19379e15-98d8-48aa-8da4-5b6beba72898) | 0.0094 / 7 |
| `390x844/42 native` | ![B](https://github.com/user-attachments/assets/1795687f-0785-41f4-a52d-061b85637096) | ![A](https://github.com/user-attachments/assets/d13664e3-14a2-4b68-aa91-dfafa35b3e3b) | 0.0084 / 6 |
| `390x844/43` | ![B](https://github.com/user-attachments/assets/088e9043-54b2-4848-a57c-6d0a61521e92) | ![A](https://github.com/user-attachments/assets/6d625e2a-fdd9-468d-bdf4-f274a127afdc) | 0.0434 / 22 |
| `390x844/43 native` | ![B](https://github.com/user-attachments/assets/1d4f2e46-15b4-4a69-92d8-47a2f7d678b3) | ![A](https://github.com/user-attachments/assets/1d41705e-25ec-4e7e-8b69-b1692cf0a0de) | 0.0409 / 21 |
| `1280x800/44` | ![B](https://github.com/user-attachments/assets/9f5f3c98-b078-4c50-a153-aac964d35606) | ![A](https://github.com/user-attachments/assets/df908f7b-6527-4699-85be-1465d858447f) | 0.0812 / 41 |
| `1280x800/45` | ![B](https://github.com/user-attachments/assets/41fdbd3d-0a45-4832-95fa-03a029e3fff6) | ![A](https://github.com/user-attachments/assets/ea321976-8231-4efd-9943-2efd06997828) | 0.0526 / 46 |
| `1280x800/46` | ![B](https://github.com/user-attachments/assets/b6526151-99a5-46b2-9e9f-bade0edf781e) | ![A](https://github.com/user-attachments/assets/d493004f-ff4a-4d8e-a518-81c356eed34c) | 0.0068 / 14 |
| `matrix/1280x800/light/46/prepare-end-default` | ![B](https://github.com/user-attachments/assets/1bbfc784-6641-41d2-bc16-e1e0fbb5e2de) | ![A](https://github.com/user-attachments/assets/0f95bb38-361b-4a67-9a35-0d53ed77d888) | 0.0068 / 14 |
| `1280x800/47` | ![B](https://github.com/user-attachments/assets/ab924caf-7e27-4984-87c2-6e7468b0b7b7) | ![A](https://github.com/user-attachments/assets/3ef28e93-71fe-4f8d-974a-3c0a4e987049) | 0.0007 / 2 |
| `1280x800/48` | ![B](https://github.com/user-attachments/assets/4077c47b-3527-43b9-84c2-7d38352de30f) | ![A](https://github.com/user-attachments/assets/39f574b9-964a-42ad-8d18-6c303ff30ca8) | 0.0007 / 2 |
| `matrix/1280x800/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/72387a7d-d734-42e6-9324-e2e30ba178a9) | ![A](https://github.com/user-attachments/assets/33e4b2ff-53f9-45e8-9307-efc22c40e768) | 0.0007 / 2 |
| `matrix/1280x800/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/593f288a-9334-48b2-93df-f333d922a161) | ![A](https://github.com/user-attachments/assets/31e7a1ce-2d87-4b11-ad6a-43dfbfef7777) | 0.0068 / 14 |
| `matrix/1280x800/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/ae4d468d-4b01-429c-bdbc-32aa35c47e91) | ![A](https://github.com/user-attachments/assets/92948f09-5c01-4ba3-a47b-ce09fca595fc) | 0.0007 / 2 |
| `matrix/1280x800/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/78c5b5b0-d150-4a1d-83e3-d17036462708) | ![A](https://github.com/user-attachments/assets/5553d064-d8e3-4318-96cd-d6dba704e67f) | 0.0007 / 2 |
| `matrix/1280x800/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/c8bb7350-71f4-4332-a87e-880b97fa256a) | ![A](https://github.com/user-attachments/assets/27d0aa3e-9701-4c44-b51c-05384f4859ee) | 0.0007 / 2 |
| `matrix/1280x800/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/6e86c56c-0984-495c-a009-10e655a30902) | ![A](https://github.com/user-attachments/assets/db0dcd61-131f-4b73-bbee-638bb0046717) | 0.0007 / 2 |
| `matrix/1280x800/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/3edd821d-c276-422e-adeb-3f210a713796) | ![A](https://github.com/user-attachments/assets/00fa438c-8908-4eaa-b4b3-266369c7adac) | 0.0007 / 2 |
| `matrix/1280x800/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/f154eaff-db23-4571-bb06-0779a6e54f91) | ![A](https://github.com/user-attachments/assets/354a8131-7679-485e-af03-bddb4dfbfe3a) | 0.0007 / 2 |
| `matrix/1280x800/light/46/top-default` | ![B](https://github.com/user-attachments/assets/9d21b02f-327d-4e5e-8998-93d45852deed) | ![A](https://github.com/user-attachments/assets/c636f033-0d38-4c41-a79f-9da8e839c1b9) | 0.0068 / 14 |
| `matrix/1280x800/light/46/end-default` | ![B](https://github.com/user-attachments/assets/6dcbb8e4-ce91-4ce8-ad62-c701520f1f62) | ![A](https://github.com/user-attachments/assets/37f4f0d1-316a-4be9-9c6e-8b4d555347ce) | 0.0007 / 2 |
| `matrix/1280x800/light/47/top-default` | ![B](https://github.com/user-attachments/assets/83a7e19b-1589-4e46-b5a5-0c58dc0b185b) | ![A](https://github.com/user-attachments/assets/eb5c8cc0-0eca-4bf2-a8f4-c1df5b66cf11) | 0.0007 / 2 |
| `matrix/1280x800/light/47/end-default` | ![B](https://github.com/user-attachments/assets/c035fb4b-a8e2-4b65-8bbb-951df199ef25) | ![A](https://github.com/user-attachments/assets/ecde17de-0397-427c-8c65-6d76285320b2) | 0.0007 / 2 |
| `matrix/1280x800/light/48/top-default` | ![B](https://github.com/user-attachments/assets/e7665712-e5a1-4d8f-8d7e-fb5e3e5907a2) | ![A](https://github.com/user-attachments/assets/8b549ec5-32d4-47e5-b8a4-cbb97b62fe5d) | 0.0007 / 2 |
| `matrix/1280x800/light/48/end-default` | ![B](https://github.com/user-attachments/assets/32041de1-3e8e-4c9a-97a7-2f47e8e666cb) | ![A](https://github.com/user-attachments/assets/5ddc200c-17ec-4e02-aae0-5732d0b68577) | 0.0007 / 2 |
| `matrix/840x620/light/46/top-default` | ![B](https://github.com/user-attachments/assets/5ee9f8a5-88ab-410f-bef2-2e112df5e4de) | ![A](https://github.com/user-attachments/assets/d7b1e5c3-ebf2-4cd9-808a-b0ade99b274d) | 0.0126 / 8 |
| `matrix/840x620/light/46/end-default` | ![B](https://github.com/user-attachments/assets/09c1aa84-d576-4a28-9f6b-dceca2c4179a) | ![A](https://github.com/user-attachments/assets/7f6649c1-e38b-4fff-8712-865f0e1b5d3e) | 0.0013 / 2 |
| `matrix/840x620/light/47/top-default` | ![B](https://github.com/user-attachments/assets/c8e2284a-f7c8-4d37-b630-82505d542759) | ![A](https://github.com/user-attachments/assets/9fa7398f-e9d2-4842-b50f-12782092aefa) | 0.0013 / 2 |
| `matrix/840x620/light/47/end-default` | ![B](https://github.com/user-attachments/assets/9c144773-8df1-4955-8209-628ec30e181e) | ![A](https://github.com/user-attachments/assets/2078a479-e53c-4a59-807c-897ec4ebd6cf) | 0.0013 / 2 |
| `matrix/840x620/light/48/top-default` | ![B](https://github.com/user-attachments/assets/ba3a3247-20b8-49db-9c34-f5013b3d59ed) | ![A](https://github.com/user-attachments/assets/63bcd2de-2bb0-4507-afa0-de8bc9d42f40) | 0.0013 / 2 |
| `matrix/840x620/light/48/end-default` | ![B](https://github.com/user-attachments/assets/3dd1b0a8-1247-4743-9398-89377ef7bd35) | ![A](https://github.com/user-attachments/assets/0f0899cb-e60e-46ec-8f73-1f134db14cc7) | 0.0013 / 2 |
| `matrix/840x620/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/bced2e0f-52e7-4b5e-aa9a-aab609fb994e) | ![A](https://github.com/user-attachments/assets/6cc09527-83f5-4a07-a485-84c5d5079876) | 0.0013 / 2 |
| `matrix/840x620/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/8957c657-106a-4d96-b4c1-885e803e99ef) | ![A](https://github.com/user-attachments/assets/813c5a3c-e108-40af-9b7f-5b7273eb124a) | 0.0126 / 8 |
| `matrix/840x620/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/68915b2c-60a8-48e6-ad02-ccca74bc68f2) | ![A](https://github.com/user-attachments/assets/05b98a60-0985-46a6-b730-8f9eeca5e076) | 0.0013 / 2 |
| `matrix/840x620/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/412ea590-0c53-4ce8-8996-9f016e68535b) | ![A](https://github.com/user-attachments/assets/00177a2a-0803-4e87-9a22-5391bd7893bf) | 0.0013 / 2 |
| `matrix/840x620/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/649b81d7-9289-4c0e-b2c2-e91683a66e4c) | ![A](https://github.com/user-attachments/assets/830a58c6-39a4-4037-9995-9ef6b58dd02d) | 0.0013 / 2 |
| `matrix/840x620/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/262843ef-8e1a-4a3f-b46f-00d5c968f1c6) | ![A](https://github.com/user-attachments/assets/7997a479-c962-46f3-8268-b9dbca340711) | 0.0013 / 2 |
| `matrix/840x620/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/ee79587d-cb20-4538-851f-3a8fe7d95b3d) | ![A](https://github.com/user-attachments/assets/9c12787f-3735-40e8-939f-e34d00e3d194) | 0.0013 / 2 |
| `matrix/840x620/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/5df35056-99c8-40e0-a19d-3db9483adba2) | ![A](https://github.com/user-attachments/assets/bbe9feb8-652f-4239-bb1f-8a85821c5382) | 0.0013 / 2 |
| `matrix/2560x1440/light/46/top-default` | ![B](https://github.com/user-attachments/assets/cf98ae86-e2ea-421a-a575-1f36992c0e6e) | ![A](https://github.com/user-attachments/assets/be91cef0-694f-417c-a0a0-090eda30a5fe) | 0.0019 / 4 |
| `matrix/2560x1440/light/46/end-default` | ![B](https://github.com/user-attachments/assets/3f6747e7-c6ad-4ec9-b67c-a83d947b689b) | ![A](https://github.com/user-attachments/assets/028221a1-22c9-4746-b64e-ec97d3c58b19) | 0.0019 / 4 |
| `matrix/2560x1440/light/47/top-default` | ![B](https://github.com/user-attachments/assets/088fe7f3-75be-4ae1-9502-d26795f1bf79) | ![A](https://github.com/user-attachments/assets/7843fde3-89c3-4bc8-98d0-c7a53fdbaa05) | 0.0002 / 1 |
| `matrix/2560x1440/light/47/end-default` | ![B](https://github.com/user-attachments/assets/2abe49ea-41ec-4e21-82fb-99b45a4aa0b6) | ![A](https://github.com/user-attachments/assets/84bdee9a-e04c-4dee-b8ea-881b89f917a2) | 0.0002 / 1 |
| `matrix/2560x1440/light/48/top-default` | ![B](https://github.com/user-attachments/assets/01c8499a-d846-4df4-9e98-bdac99657e2a) | ![A](https://github.com/user-attachments/assets/93e0eb27-ef08-4273-968b-00251bd3a26b) | 0.0002 / 1 |
| `matrix/2560x1440/light/48/end-default` | ![B](https://github.com/user-attachments/assets/55866277-c3c8-4e61-995b-28dcbdee81de) | ![A](https://github.com/user-attachments/assets/99fc0680-f99a-40e2-8750-dce2747f3715) | 0.0002 / 1 |
| `matrix/2560x1440/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/3703b311-9d3e-4928-8e9b-43b087d365a3) | ![A](https://github.com/user-attachments/assets/2f35a282-308f-42fd-8bae-43092836b01c) | 0.0002 / 1 |
| `matrix/2560x1440/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/ac3bc614-020b-4f48-9d85-fee61a7c7753) | ![A](https://github.com/user-attachments/assets/8e0a5e32-afa7-428b-87d6-1fc01653f7c7) | 0.0019 / 4 |
| `matrix/2560x1440/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/567cb7fb-6c97-49d3-9aef-8996c2703030) | ![A](https://github.com/user-attachments/assets/c112492b-035b-42ea-994b-fb17e25362ba) | 0.0019 / 4 |
| `matrix/2560x1440/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/43202fcc-ca0f-4ed7-8a3d-e03cbe6db05d) | ![A](https://github.com/user-attachments/assets/4681adb7-f257-4baa-a089-28ab7231d7f5) | 0.0002 / 1 |
| `matrix/2560x1440/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/a5819f70-42c9-41f4-af7c-97e9a1b0a8b9) | ![A](https://github.com/user-attachments/assets/e2bdf099-b687-4178-b6cd-be66cce196e2) | 0.0002 / 1 |
| `matrix/2560x1440/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/539f9dbc-3cf6-4d01-89c8-c5dd3c1cfe78) | ![A](https://github.com/user-attachments/assets/ba655847-a8c3-420a-bb5d-82915cc65b28) | 0.0002 / 1 |
| `matrix/2560x1440/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/53aac127-323e-43e5-bf69-6ea8e4d72ee1) | ![A](https://github.com/user-attachments/assets/37191853-5141-4242-a33b-dbbde2509409) | 0.0002 / 1 |
| `matrix/2560x1440/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/18771956-0de8-49be-b63d-d3d0f6bd6bf8) | ![A](https://github.com/user-attachments/assets/ab289610-31d5-441e-9f85-f70c850ed2b4) | 0.0002 / 1 |
| `1920x1080/01` | ![B](https://github.com/user-attachments/assets/0c4903a5-a585-465f-bc4b-16a403e854e5) | ![A](https://github.com/user-attachments/assets/0f2b20e5-7cd5-4f75-a38a-1026dcea1e5d) | 0.0012 / 6 |
| `1920x1080/02` | ![B](https://github.com/user-attachments/assets/2ab44d77-2194-43d6-a293-690557eaece9) | ![A](https://github.com/user-attachments/assets/1a413f74-2509-4c54-8ed9-f3ac4a5227ec) | 0.0012 / 1 |
| `1920x1080/03` | ![B](https://github.com/user-attachments/assets/8f76b023-65e7-4593-b133-49a8fd3679b2) | ![A](https://github.com/user-attachments/assets/064ed700-42aa-4577-b399-5ea978877f63) | 0.0012 / 7 |
| `1920x1080/04` | ![B](https://github.com/user-attachments/assets/701d07ce-96b6-47e5-bf78-6ff5cb377b58) | ![A](https://github.com/user-attachments/assets/47ed44b3-c64e-44fd-824b-85332225eda3) | 0.0003 / 1 |
| `1920x1080/05` | ![B](https://github.com/user-attachments/assets/32d2acc7-09ee-46e2-8375-af839244fbb3) | ![A](https://github.com/user-attachments/assets/b6e2461b-71f2-40e9-9ac4-cb1d5fba123f) | 0.0012 / 1 |
| `1920x1080/06` | ![B](https://github.com/user-attachments/assets/ed2bae71-f521-42e2-984b-9185fc09c85b) | ![A](https://github.com/user-attachments/assets/8f1c9f12-8f89-4a51-abc0-7a5a7c4b7eb8) | 0.0017 / 5 |
| `1920x1080/07` | ![B](https://github.com/user-attachments/assets/4edbcf5a-43eb-492c-8fdd-6902409d2fb8) | ![A](https://github.com/user-attachments/assets/7dfcc3cb-ae51-4c2f-84ef-7b19fc572202) | 0.0168 / 11 |
| `1920x1080/08` | ![B](https://github.com/user-attachments/assets/36c5cc44-edba-4886-af0e-7b36a732319c) | ![A](https://github.com/user-attachments/assets/171e9413-fcff-42c9-8df2-9fcc31dc0667) | 0.0221 / 11 |
| `1920x1080/09` | ![B](https://github.com/user-attachments/assets/f5f95203-239a-4852-aa41-b62cd741ad27) | ![A](https://github.com/user-attachments/assets/30be74e9-0e96-4da7-a7eb-06bd2f6b0093) | 0.0168 / 11 |
| `1920x1080/10` | ![B](https://github.com/user-attachments/assets/1a0d6276-a8ac-45a6-87ed-c627b500a8ce) | ![A](https://github.com/user-attachments/assets/90107750-7030-4218-a45a-21fa6972eb61) | 0.0168 / 11 |
| `1920x1080/11` | ![B](https://github.com/user-attachments/assets/b8ab9122-1cca-410b-8527-306ee86fd1da) | ![A](https://github.com/user-attachments/assets/856b841f-d561-4762-a1e2-3230bea96661) | 0.0141 / 14 |
| `1920x1080/12` | ![B](https://github.com/user-attachments/assets/74a1a96a-a662-4d16-b24d-8780c836ab00) | ![A](https://github.com/user-attachments/assets/526685ad-f2ad-4b26-ad7c-c9365d910f47) | 0.0168 / 11 |
| `1920x1080/13` | ![B](https://github.com/user-attachments/assets/ff71e896-3686-49ee-a35c-857370aa3d92) | ![A](https://github.com/user-attachments/assets/aace9c62-b223-4d89-a41e-b9f0c7b29d0b) | 0.0168 / 11 |
| `1920x1080/14` | ![B](https://github.com/user-attachments/assets/e46dddb2-26b2-44f5-b84d-1ee224384aab) | ![A](https://github.com/user-attachments/assets/c505e0da-51e4-4f1c-b799-f83d35346fcf) | 0.0117 / 14 |
| `1920x1080/15` | ![B](https://github.com/user-attachments/assets/d0f00dfe-1965-40d7-990e-72bc4110bcd5) | ![A](https://github.com/user-attachments/assets/500d0562-05d8-410b-a9ac-0f016ef7186e) | 0.0253 / 18 |
| `1920x1080/16` | ![B](https://github.com/user-attachments/assets/750669df-f4df-49b2-8b35-736717cf29d1) | ![A](https://github.com/user-attachments/assets/6594ee6a-272c-41cc-bdac-79af6d169f92) | 0.0168 / 11 |
| `1920x1080/17` | ![B](https://github.com/user-attachments/assets/d7f01121-ace0-45f3-9426-23bc098d14bc) | ![A](https://github.com/user-attachments/assets/35d44677-9660-4551-8abd-ff89d8717650) | 0.0003 / 1 |
| `1920x1080/18` | ![B](https://github.com/user-attachments/assets/17246a8a-4331-433f-80e3-59e389dd163e) | ![A](https://github.com/user-attachments/assets/eb85757a-1b95-49f5-a401-993c2f443a06) | 0.0005 / 11 |
| `1920x1080/19` | ![B](https://github.com/user-attachments/assets/a8355f8d-e85d-4b20-948d-3588b409eed1) | ![A](https://github.com/user-attachments/assets/d264dec3-be1f-4b4e-af48-a8b151bf5fd6) | 0.0005 / 15 |
| `1920x1080/20` | ![B](https://github.com/user-attachments/assets/c313c34c-78a8-4034-ae83-1cf910d3f6f1) | ![A](https://github.com/user-attachments/assets/3ec459f1-4746-4ea6-beef-7fb59f9aad11) | 0.0003 / 1 |
| `1920x1080/21` | ![B](https://github.com/user-attachments/assets/f70ae003-494c-40f5-8d7f-806c14d2b9cf) | ![A](https://github.com/user-attachments/assets/8136362f-9162-40a3-92e7-40861c3cc9df) | 0.0003 / 1 |
| `1920x1080/22` | ![B](https://github.com/user-attachments/assets/f6f18de0-cf95-4b17-b39d-6ec7e488d5d2) | ![A](https://github.com/user-attachments/assets/39814bd6-13de-4732-aa40-309b474e86a4) | 0.0003 / 1 |
| `1920x1080/23` | ![B](https://github.com/user-attachments/assets/82af9567-8048-45cb-9b82-541379d4daf8) | ![A](https://github.com/user-attachments/assets/c72d9c0a-e360-44d5-91cb-afec1a9a5017) | 0.0003 / 1 |
| `1920x1080/24` | ![B](https://github.com/user-attachments/assets/0221a2ae-b537-4d57-b76b-709b5820d46e) | ![A](https://github.com/user-attachments/assets/cc75c6b7-29ad-4663-86d8-ae8cd3ce4e35) | 0.0003 / 1 |
| `1920x1080/25` | ![B](https://github.com/user-attachments/assets/f03ef5fe-c128-43c9-80e1-5ba1d3d5fd1e) | ![A](https://github.com/user-attachments/assets/72604ec1-ccc5-4895-8a7e-48ded9c0d5eb) | 0.0003 / 1 |
| `1920x1080/26` | ![B](https://github.com/user-attachments/assets/0c531fdf-67c3-4c94-a1a6-de2564f4b39e) | ![A](https://github.com/user-attachments/assets/f03558cd-52f3-4564-ba77-9bb5c33f1196) | 0.0003 / 1 |
| `1920x1080/27` | ![B](https://github.com/user-attachments/assets/a55289f2-3bff-43c8-b722-bdf32932b1e1) | ![A](https://github.com/user-attachments/assets/70cb1688-03d0-47a0-983a-d3f2e7fc3310) | 0.0003 / 1 |
| `1920x1080/28` | ![B](https://github.com/user-attachments/assets/8e7cb272-04a4-4abc-b925-ceb1d8bed5ea) | ![A](https://github.com/user-attachments/assets/7531a50d-3ae8-4d0f-8e23-5681456baa61) | 0.0003 / 1 |
| `1920x1080/29` | ![B](https://github.com/user-attachments/assets/f0c46393-7fc9-448a-b659-215670de11c0) | ![A](https://github.com/user-attachments/assets/932b5487-6c51-4dd3-85ce-c1afe5c0d499) | 0.0038 / 17 |
| `1920x1080/30` | ![B](https://github.com/user-attachments/assets/82a44279-8f83-4821-a1a6-211fc11413ab) | ![A](https://github.com/user-attachments/assets/e801d0e5-a90c-4902-83a0-708f47cce519) | 0.0003 / 1 |
| `1920x1080/31` | ![B](https://github.com/user-attachments/assets/61d3d6be-f97a-46db-ad17-3d38ddefcce3) | ![A](https://github.com/user-attachments/assets/5d174795-0e96-4f4b-8d6b-4a399dc8580c) | 0.0135 / 11 |
| `1920x1080/32` | ![B](https://github.com/user-attachments/assets/0a61d2dd-7893-4045-9f46-c0b747e1ead8) | ![A](https://github.com/user-attachments/assets/71cf8332-7471-435c-9c2e-b0f21b9a706d) | 0.0138 / 11 |
| `1920x1080/33` | ![B](https://github.com/user-attachments/assets/7e860af4-a13a-4133-b6b3-b5d39fadb28f) | ![A](https://github.com/user-attachments/assets/34409e59-faa9-4212-b11e-3386db722933) | 0.0168 / 12 |
| `1920x1080/34` | ![B](https://github.com/user-attachments/assets/f1d793e8-fd0f-41e1-8ded-f89a532a328f) | ![A](https://github.com/user-attachments/assets/3c41c8d3-ed31-4141-ba5a-58de2e852e0f) | 0.0076 / 12 |
| `1920x1080/35` | ![B](https://github.com/user-attachments/assets/95a63ed3-fb5e-492f-86d5-c65108efb5a9) | ![A](https://github.com/user-attachments/assets/aca54027-58f2-48e0-a3cc-4bfa523d6813) | 0.0076 / 13 |
| `1920x1080/36` | ![B](https://github.com/user-attachments/assets/adf31d54-f0a0-4686-a6db-bbe37ed80385) | ![A](https://github.com/user-attachments/assets/00428232-7af6-41ac-a0d7-e7c67abdaa92) | 0.0076 / 12 |
| `1920x1080/36 native` | ![B](https://github.com/user-attachments/assets/da88033e-9952-45a5-aad0-2b28f2580ec1) | ![A](https://github.com/user-attachments/assets/678105bd-2231-4ac6-91d5-71e951d47a9c) | 0.0067 / 12 |
| `1920x1080/37` | ![B](https://github.com/user-attachments/assets/b7294a6d-2801-43a0-9484-557f7c27d219) | ![A](https://github.com/user-attachments/assets/fc229545-a7d9-4aa6-a05e-11d85e7bc0b6) | 0.0076 / 13 |
| `1920x1080/38` | ![B](https://github.com/user-attachments/assets/f665bb00-6289-43e7-954b-42dc51974721) | ![A](https://github.com/user-attachments/assets/10bfc9e4-edbe-497b-9438-191c8aee467c) | 0.0065 / 12 |
| `1920x1080/39` | ![B](https://github.com/user-attachments/assets/9c29d88f-43e0-441e-a882-f4d3afa874e7) | ![A](https://github.com/user-attachments/assets/fd78abb0-de45-476d-b169-aea491526756) | 0.0083 / 13 |
| `1920x1080/40` | ![B](https://github.com/user-attachments/assets/903d9617-8afe-4064-937d-77273fce713b) | ![A](https://github.com/user-attachments/assets/8fe53878-773c-4065-aeef-e676b1bca24d) | 0.0083 / 14 |
| `1920x1080/41` | ![B](https://github.com/user-attachments/assets/8799ee41-c15f-490b-bb9f-f61c7424be55) | ![A](https://github.com/user-attachments/assets/eab1de5e-11a1-489f-bf3e-4d15a1cc4296) | 0.0063 / 11 |
| `1920x1080/41 native` | ![B](https://github.com/user-attachments/assets/5529f6e5-b4d8-43f7-8ea0-77b03a02279e) | ![A](https://github.com/user-attachments/assets/80d703f5-dd77-4b9f-bed2-1268b3d0f44c) | 0.0055 / 11 |
| `1920x1080/44` | ![B](https://github.com/user-attachments/assets/e45c6044-a8ad-496c-9445-5cbccb151a9c) | ![A](https://github.com/user-attachments/assets/2799733b-9bd6-4e92-82cb-f236ae4f9255) | 0.0142 / 13 |
| `1920x1080/45` | ![B](https://github.com/user-attachments/assets/b6c31467-ebe5-4195-8779-a4e994b34637) | ![A](https://github.com/user-attachments/assets/157c8a28-50a3-49ac-8f44-26736b103272) | 0.0076 / 12 |
| `1920x1080/46` | ![B](https://github.com/user-attachments/assets/b9eaf3ce-387d-42eb-8166-afc03931ee3a) | ![A](https://github.com/user-attachments/assets/61a47679-0447-4a1e-a426-960522163ed9) | 0.0034 / 6 |
| `matrix/1920x1080/light/46/prepare-end-default` | ![B](https://github.com/user-attachments/assets/88f736e2-338f-489f-8a7b-a186a4ba3268) | ![A](https://github.com/user-attachments/assets/bb6b5199-26b7-447a-b3d4-a0a3496dffe9) | 0.0034 / 6 |
| `1920x1080/47` | ![B](https://github.com/user-attachments/assets/76bd83c4-1044-4d81-bf98-336aa7a14198) | ![A](https://github.com/user-attachments/assets/89466d05-55bd-4160-8117-1797b2dc4ac3) | 0.0003 / 1 |
| `1920x1080/48` | ![B](https://github.com/user-attachments/assets/9acd2fa4-e15e-46db-8ff3-cbb7855ca0fd) | ![A](https://github.com/user-attachments/assets/aa445ee9-e372-4929-b920-43ff6e66f2d0) | 0.0003 / 1 |
| `matrix/1920x1080/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/b27cbecb-685b-4ed1-92ba-6a586dc669c4) | ![A](https://github.com/user-attachments/assets/619b5a68-b847-4284-bfce-3dc4fdedcde8) | 0.0003 / 1 |
| `matrix/1920x1080/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/21f92b6d-0e15-4226-a90b-1a00ebf543ba) | ![A](https://github.com/user-attachments/assets/ac2c37ee-64f3-495c-ad1e-503a8aee06a9) | 0.0034 / 6 |
| `matrix/1920x1080/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/0f6073ed-c71e-473a-ae01-252c594e17df) | ![A](https://github.com/user-attachments/assets/009afe0a-87e4-404d-a138-ddda8dea0452) | 0.0034 / 10 |
| `matrix/1920x1080/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/28a3cc37-8b4a-472a-8cd9-3c7d117faf27) | ![A](https://github.com/user-attachments/assets/2de74f72-d844-4457-bc93-b463925aeb55) | 0.0003 / 1 |
| `matrix/1920x1080/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/e6326c7c-a565-4a07-873a-d392d1e01e16) | ![A](https://github.com/user-attachments/assets/216bfef1-7e70-4403-a045-dc3f0a45c92f) | 0.0003 / 1 |
| `matrix/1920x1080/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/65f994b9-0c22-4349-b1f6-84ab3d0afead) | ![A](https://github.com/user-attachments/assets/5c674755-3e4d-42f1-b1e8-c64241d53605) | 0.0003 / 1 |
| `matrix/1920x1080/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/e4a4d8e7-1d07-4bd3-9acd-3245a4dbbd63) | ![A](https://github.com/user-attachments/assets/2dfb20e1-208e-4334-8610-20c4c3856ca4) | 0.0003 / 1 |
| `matrix/1920x1080/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/1df54da4-ef86-4fa1-9b8c-e457e26b0499) | ![A](https://github.com/user-attachments/assets/720e97e5-8fb4-4b1a-83af-6ca2928921fd) | 0.0003 / 1 |
| `matrix/1920x1080/light/46/top-default` | ![B](https://github.com/user-attachments/assets/700d8046-025a-4f1e-8293-ab5e1cc274b0) | ![A](https://github.com/user-attachments/assets/183f9d6d-4435-4b20-8693-a74b6f024b99) | 0.0034 / 6 |
| `matrix/1920x1080/light/46/end-default` | ![B](https://github.com/user-attachments/assets/fbb23635-e2c4-410e-9f4f-1ad60a059f5d) | ![A](https://github.com/user-attachments/assets/977aaca3-85f5-48ff-b1e0-ab8f6752f0d4) | 0.0034 / 10 |
| `matrix/1920x1080/light/47/top-default` | ![B](https://github.com/user-attachments/assets/e12077d1-a0d4-4dcc-a2d1-7f1958c3e00d) | ![A](https://github.com/user-attachments/assets/28e76db5-5b0c-49fe-be8c-d583b11760ec) | 0.0003 / 1 |
| `matrix/1920x1080/light/47/end-default` | ![B](https://github.com/user-attachments/assets/e577c6c1-c453-49d9-a9df-604eec798f79) | ![A](https://github.com/user-attachments/assets/54d8bcef-e6e7-40e7-b84b-aa1c7997eec8) | 0.0003 / 1 |
| `matrix/1920x1080/light/48/top-default` | ![B](https://github.com/user-attachments/assets/23200c7b-22fe-4b3d-806d-d119185024d5) | ![A](https://github.com/user-attachments/assets/2305301e-b4e2-4835-b852-86620ac8a586) | 0.0003 / 1 |
| `matrix/1920x1080/light/48/end-default` | ![B](https://github.com/user-attachments/assets/92bf0154-6366-45b4-89a0-ac3be4727e1b) | ![A](https://github.com/user-attachments/assets/3da3e18a-e5fc-4b85-ad52-0975705f23e6) | 0.0003 / 1 |
| `w27/theme-inspector-armed` | ![B](https://github.com/user-attachments/assets/4abc49c4-b544-4edb-97a1-bacdc81c642f) | ![A](https://github.com/user-attachments/assets/147abdde-0abf-457a-8746-cf55e3f86956) | 0.0444 / 33 |
| `w27/06-popup-in-dialog` | ![B](https://github.com/user-attachments/assets/2fbd8330-50a8-463e-8962-1cac164833d6) | ![A](https://github.com/user-attachments/assets/fe707440-c186-4463-921b-50da4d82c98f) | 0.0036 / 6 |
| `w27/tooltip` | ![B](https://github.com/user-attachments/assets/1c4c6bea-251b-4cb9-b7b0-641f8d25c079) | ![A](https://github.com/user-attachments/assets/6fb11453-3a7e-4ef0-85be-99c1b15a1749) | 0.0340 / 24 |
| `w27/34-selection-toolbar` | ![B](https://github.com/user-attachments/assets/153f73bb-2b2d-4e98-9c9e-655ff961727f) | ![A](https://github.com/user-attachments/assets/06e73dc9-5a3d-457f-99a9-43cf7ecff740) | 0.0155 / 14 |
| `w27/11-popover-in-dialog` | ![B](https://github.com/user-attachments/assets/5ce8279d-0a25-4d01-9b43-867e8cbbdee2) | ![A](https://github.com/user-attachments/assets/be14564b-47c7-44b2-b088-5389b36d54c1) | 0.0721 / 42 |
| `w27/theme-editor-popover` | ![B](https://github.com/user-attachments/assets/f157b5a9-6674-4ff4-b285-fdf081fb560d) | ![A](https://github.com/user-attachments/assets/ddd02d55-4f39-4f77-b297-fd79910dfd1b) | 0.0211 / 28 |
| `w27/05-command-palette` | ![B](https://github.com/user-attachments/assets/976c540a-630c-431e-8d14-6fcf259feabf) | ![A](https://github.com/user-attachments/assets/5e21c77f-4858-4195-bf51-466238822643) | 0.0024 / 2 |
| `w27/14-dialog` | ![B](https://github.com/user-attachments/assets/33947669-2f80-4fc9-a2b2-98d7e61ea562) | ![A](https://github.com/user-attachments/assets/ee26eece-a7c4-4007-b030-3dcc59eaa706) | 0.0823 / 38 |
| `w27/31-model-popup` | ![B](https://github.com/user-attachments/assets/77020e8d-ce77-4e5a-bb62-d61c549bcecf) | ![A](https://github.com/user-attachments/assets/993d58e6-b50d-4471-a9c6-4db797d69e62) | 0.0360 / 24 |
| `w27/11-add-action-dialog` | ![B](https://github.com/user-attachments/assets/8ac15866-92dc-4a23-990d-c1b0d6fa3460) | ![A](https://github.com/user-attachments/assets/f2b9967b-410e-4f75-b4ec-dbd720d442cc) | 0.0733 / 41 |
| `w29/18-appearance-wireframes-light` | ![B](https://github.com/user-attachments/assets/8bae3a39-cfa2-4d84-afa0-0ea14ba99258) | ![A](https://github.com/user-attachments/assets/7983b019-fa7c-4dbf-adfa-872763c088bf) | 0.0449 / 31 |
| `w29/31-model-popup-dark` | ![B](https://github.com/user-attachments/assets/128b4edc-5036-423c-ab8e-6119161a2952) | ![A](https://github.com/user-attachments/assets/9127d0ff-df86-4c7e-a481-35474af911a7) | 0.0192 / 18 |
| `w29/14-dialog-dark` | ![B](https://github.com/user-attachments/assets/7cb20dd6-ace1-4012-9759-d147acafadab) | ![A](https://github.com/user-attachments/assets/5adda905-3196-4a95-8c49-cac760a33fc6) | 0.0744 / 31 |
| `w29/19-appearance-wireframes-dark` | ![B](https://github.com/user-attachments/assets/8c6bce02-84c9-46e1-91fe-78ff15017578) | ![A](https://github.com/user-attachments/assets/1e34bad3-2fe6-47f8-89d5-4f3a19da0193) | 0.0010 / 16 |
| `motion/dialog-reduced-open-end` | ![B](https://github.com/user-attachments/assets/062fc11c-22af-47e6-ad3e-71d66239172b) | ![A](https://github.com/user-attachments/assets/9f241ca6-3ac6-4aac-8d96-d70bf3034876) | 0.1200 / 52 |
| `motion/dialog-normal-open-mid` | ![B](https://github.com/user-attachments/assets/ceee9576-7709-462b-a413-ca1bc2765437) | ![A](https://github.com/user-attachments/assets/2a91bda0-0fe1-42ff-af18-56ea18620dc2) | 0.2429 / 52 |
| `motion/dialog-normal-open-end` | ![B](https://github.com/user-attachments/assets/dd0a9bb4-bf72-4ef2-8881-1b1f2d18bc5a) | ![A](https://github.com/user-attachments/assets/4b1e0de7-2492-4a20-9b4e-266a7221e888) | 0.0883 / 43 |
| `motion/dialog-reduced-open-mid` | ![B](https://github.com/user-attachments/assets/ea377e71-1724-41c7-b7b8-38330712a0a1) | ![A](https://github.com/user-attachments/assets/831d421a-5b65-4d41-bf7f-a2a4820be606) | 0.4739 / 62 |
| `motion/dialog-normal-open-start` | ![B](https://github.com/user-attachments/assets/f62170af-d1ac-42c9-b67f-e38d564d65a0) | ![A](https://github.com/user-attachments/assets/9302c8a5-ef1a-492b-99bd-d22f632e0997) | 0.0366 / 29 |
| `motion/dialog-reduced-open-start` | ![B](https://github.com/user-attachments/assets/67cd8bc0-5aee-4737-8b6b-8573e9ef414c) | ![A](https://github.com/user-attachments/assets/bef6e1d3-f931-4148-ab68-234aab4d9190) | 0.0694 / 46 |
| `motion/dialog-normal-interrupted` | ![B](https://github.com/user-attachments/assets/50db74c5-6067-42c7-b786-837bccc20414) | ![A](https://github.com/user-attachments/assets/f66de50a-16ff-4aca-bd8c-3c8d34a2b04d) | 0.2429 / 52 |
| `motion/dialog-reduced-interrupted` | ![B](https://github.com/user-attachments/assets/2ec254f5-0eba-44da-9969-bf320449fd19) | ![A](https://github.com/user-attachments/assets/4d0c2696-fd91-49c4-ae9c-52353b0d5a59) | 0.4881 / 60 |
| `w28/sidebar-expand-mid` | ![B](https://github.com/user-attachments/assets/762d863f-3cc2-4862-a9ae-4044dfda21f3) | ![A](https://github.com/user-attachments/assets/ca47e168-1e36-4ede-b8a9-09f751f5d88a) | 0.2784 / 41 |
| `w28/sidebar-collapse-mid` | ![B](https://github.com/user-attachments/assets/9599a2c0-f839-4588-b751-601f108757ae) | ![A](https://github.com/user-attachments/assets/3ef5ca7c-4c3f-4692-9666-4a54ba4516e5) | 0.0853 / 29 |
| `w28/15-browser-pane` | ![B](https://github.com/user-attachments/assets/d1b68d0c-0f68-46c7-8d1f-27f6e621bc1d) | ![A](https://github.com/user-attachments/assets/6654a8ce-ee0f-4d2f-8cdc-8e24d04d4852) | 0.0366 / 29 |
| `w28/sidebar-collapsed` | ![B](https://github.com/user-attachments/assets/6494acf9-a209-49de-8a3c-a3e3b31918b0) | ![A](https://github.com/user-attachments/assets/610e7682-d099-4de2-9140-a558b341a1d5) | 0.0356 / 25 |
| `motion-clean/dialog-reduced-open-end` | ![B](https://github.com/user-attachments/assets/fe5ae94d-4256-43c3-b76c-a64c9762dd75) | ![A](https://github.com/user-attachments/assets/df71c1af-ca9f-4c1f-a4b1-7b1737e6fa80) | 0.0938 / 45 |
| `motion-clean/dialog-normal-open-mid` | ![B](https://github.com/user-attachments/assets/aead6b2f-4faf-413a-9dc9-ec74c53dcd30) | ![A](https://github.com/user-attachments/assets/b043b41b-81c8-4aad-ab2f-466a8f10742b) | 0.2856 / 60 |
| `motion-clean/dialog-normal-open-end` | ![B](https://github.com/user-attachments/assets/0604dfbe-61b5-4631-bb85-3d07e4e605c0) | ![A](https://github.com/user-attachments/assets/3127fdc7-b9a8-4181-beb7-72b64e27175b) | 0.0938 / 45 |
| `motion-clean/dialog-reduced-open-mid` | ![B](https://github.com/user-attachments/assets/2fdfa212-76fb-4613-9fde-f78c629a833a) | ![A](https://github.com/user-attachments/assets/e071f98b-244c-42b5-aa7c-a502be6433db) | 0.4682 / 60 |
| `motion-clean/dialog-normal-open-start` | ![B](https://github.com/user-attachments/assets/ee0a8a45-43ac-4d28-b89a-3aaae391b63f) | ![A](https://github.com/user-attachments/assets/9635d998-d086-462c-8590-cd6b0ada7a64) | 0.0340 / 24 |
| `motion-clean/dialog-reduced-open-start` | ![B](https://github.com/user-attachments/assets/aefa8811-ac56-4f26-beb4-5b1627e75e3c) | ![A](https://github.com/user-attachments/assets/6668e132-da53-4e5a-93ea-0b1e8f17621c) | 0.0347 / 26 |
| `motion-clean/dialog-normal-interrupted` | ![B](https://github.com/user-attachments/assets/26e798ed-067a-43c8-ae2c-f1a935dd4818) | ![A](https://github.com/user-attachments/assets/115bc0f5-aacb-40a3-ae5e-e8ba4d6e0cec) | 0.2856 / 60 |
| `motion-clean/dialog-reduced-interrupted` | ![B](https://github.com/user-attachments/assets/148f9181-c35a-42a8-ad33-dd07a1f6eb47) | ![A](https://github.com/user-attachments/assets/5cfee7cc-5745-42b3-9f9f-11fd38fe150f) | 0.4728 / 60 |

### Executed scenario frames (latest fresh run)

| State | After |
|---|---|
| `portal-owner/command-light` | ![A](https://github.com/user-attachments/assets/fadb3071-ab95-4174-a1c1-4ad1ce8b06f6) |
| `portal-owner/dialog-light` | ![A](https://github.com/user-attachments/assets/2a1316e9-a911-4583-a046-b81848895a49) |
| `portal-owner/modal-child-light` | ![A](https://github.com/user-attachments/assets/fd359b0b-b103-449d-ad2b-717c2ce0bbcf) |
| `portal-owner/model-light` | ![A](https://github.com/user-attachments/assets/a244cab3-3acf-439e-b23e-176622080f4e) |
| `portal-owner/select-in-dialog-light` | ![A](https://github.com/user-attachments/assets/86d4f9a6-2875-4f91-9cc7-718639f3ee13) |
| `portal-owner/image-modal-light` | ![A](https://github.com/user-attachments/assets/833afae6-795e-46a5-a1ed-1691522e16a1) |
| `portal-owner/theme-editor-light` | ![A](https://github.com/user-attachments/assets/242b93af-fb8a-4bb0-9e67-bd4cb8373ffb) |
| `portal-owner/theme-inspector-light` | ![A](https://github.com/user-attachments/assets/ead3a600-0efe-4585-8db5-d37235863a01) |
| `portal-owner/selection-toolbar-light` | ![A](https://github.com/user-attachments/assets/e43d0ae7-229a-4554-8945-a8cbc961194c) |
| `portal-owner/tooltip-light` | ![A](https://github.com/user-attachments/assets/01c89a39-7c89-482f-b36c-810112322d0e) |
| `portal-owner/quit-overlay-light` | ![A](https://github.com/user-attachments/assets/98f3967c-5e31-4419-9537-931c49b21430) |
| `portal-owner/command-dark` | ![A](https://github.com/user-attachments/assets/e39ff9e3-aeb1-45bf-9a46-eeddee8011bf) |
| `portal-owner/dialog-dark` | ![A](https://github.com/user-attachments/assets/66fe38ae-8468-425a-8671-b5e03d45e2a3) |
| `portal-owner/modal-child-dark` | ![A](https://github.com/user-attachments/assets/528368be-afe1-4060-a615-1161972773d6) |
| `portal-owner/model-dark` | ![A](https://github.com/user-attachments/assets/4fd89dc7-8d2a-4312-9874-686cf4d97dc0) |
| `portal-owner/select-in-dialog-dark` | ![A](https://github.com/user-attachments/assets/9ef129ea-0c31-44a8-8ab7-fe314f5540d6) |
| `portal-owner/image-modal-dark` | ![A](https://github.com/user-attachments/assets/199e1d66-7fb6-4cf2-948f-f4e997f64793) |
| `portal-owner/theme-editor-dark` | ![A](https://github.com/user-attachments/assets/ab6adc4b-49b4-4ae9-979b-65e84bf8b1af) |
| `portal-owner/theme-inspector-dark` | ![A](https://github.com/user-attachments/assets/90bea5bb-da25-4a4f-a71d-57eb701ce2d4) |
| `portal-owner/selection-toolbar-dark` | ![A](https://github.com/user-attachments/assets/d4f5907c-1611-4ad0-9f23-f482f4b15d45) |
| `portal-owner/tooltip-dark` | ![A](https://github.com/user-attachments/assets/c34ce2e4-b73b-45b9-86af-6fc117a38c68) |
| `portal-owner/quit-overlay-dark` | ![A](https://github.com/user-attachments/assets/f54e3c86-f33c-4300-8064-ef15328cf284) |
| `portal-owner/result` | ![A](https://github.com/user-attachments/assets/bd29919d-66b2-4df1-9aed-39f3ecdd40e7) |
| `escape-focus-return/child-escape` | ![A](https://github.com/user-attachments/assets/82f27afa-fb88-4c6a-bfcd-c05082a1a65b) |
| `escape-focus-return/result` | ![A](https://github.com/user-attachments/assets/6dda902c-e987-46c0-83b7-8ad261b0a3ac) |
| `compositor-motion/normal-consumers` | ![A](https://github.com/user-attachments/assets/6d38d965-aefc-4169-958c-b4e33ec6910b) |
| `compositor-motion/normal-start` | ![A](https://github.com/user-attachments/assets/674bc3f2-6ac1-4aa3-8130-42d7159d3e72) |
| `compositor-motion/normal-mid` | ![A](https://github.com/user-attachments/assets/a468ebf5-ca8d-4af7-8bcf-e484f59bad44) |
| `compositor-motion/normal-end` | ![A](https://github.com/user-attachments/assets/200c1bd7-77bf-478b-ba68-957a1e88be9d) |
| `compositor-motion/normal-interrupted` | ![A](https://github.com/user-attachments/assets/b86c3758-a5e2-43ec-8eb0-42200f9f2f20) |
| `compositor-motion/result` | ![A](https://github.com/user-attachments/assets/07279229-c602-4e5a-863f-fe9f148c9d35) |
| `reduced-motion/reduced-consumers` | ![A](https://github.com/user-attachments/assets/e29bd10a-aa79-457d-8adf-2cd45904177e) |
| `reduced-motion/reduced-start` | ![A](https://github.com/user-attachments/assets/3b47018c-6339-4376-bd34-b8277bc9e51d) |
| `reduced-motion/reduced-mid` | ![A](https://github.com/user-attachments/assets/19b85282-4ffc-49a5-870a-5e1b4031245e) |
| `reduced-motion/reduced-end` | ![A](https://github.com/user-attachments/assets/3a0c64a9-51f5-445b-900c-75b10fed597a) |
| `reduced-motion/reduced-interrupted` | ![A](https://github.com/user-attachments/assets/bece1259-af98-4705-89b4-51cb8d9cf8ab) |
| `reduced-motion/result` | ![A](https://github.com/user-attachments/assets/6ad068f2-802e-41dd-8b15-5e9e49999116) |
| `semantic-colors/tokens-light` | ![A](https://github.com/user-attachments/assets/31fedcfe-1543-49e7-964b-222a3b28707d) |
| `semantic-colors/tokens-dark` | ![A](https://github.com/user-attachments/assets/e770d6a6-a762-46d8-a85a-21a5c7ed01fb) |
| `semantic-colors/result` | ![A](https://github.com/user-attachments/assets/bdc73505-b7c6-48f3-96b8-fb9836576e10) |
| `contrast/tool-error-light` | ![A](https://github.com/user-attachments/assets/4056e1bd-e04d-47da-a501-84eab96fc0b9) |
| `contrast/dialog-title-light` | ![A](https://github.com/user-attachments/assets/7ae04d17-dfae-4542-a7af-79a8227ee83d) |
| `contrast/tooltip-light` | ![A](https://github.com/user-attachments/assets/7f444f55-6b61-437f-a75f-2187c22e67a3) |
| `contrast/tool-error-dark` | ![A](https://github.com/user-attachments/assets/a995288c-61de-47a9-b672-0ec4fb1fff0f) |
| `contrast/dialog-title-dark` | ![A](https://github.com/user-attachments/assets/296edab5-f717-4dfc-b964-43a720242a2e) |
| `contrast/tooltip-dark` | ![A](https://github.com/user-attachments/assets/48704619-6ff2-4fdb-a9d9-99f4d2a12fa8) |
| `contrast/result` | ![A](https://github.com/user-attachments/assets/b03c3155-a7dd-49bf-bede-944688ee845e) |
| `icon-targets/icon-targets` | ![A](https://github.com/user-attachments/assets/b022b448-c408-4b5e-a786-71e7a7e085d6) |
| `icon-targets/result` | ![A](https://github.com/user-attachments/assets/e077bbb2-1008-4f0e-8333-93448fa147e7) |
| `frozen-network-notices/frozen-browser-toolbar` | ![A](https://github.com/user-attachments/assets/6209e2b7-ce85-4dd9-8575-98b6a3975a3d) |
| `frozen-network-notices/result` | ![A](https://github.com/user-attachments/assets/2c7eab67-58a3-40ae-a753-3bbdbc2bb19f) |

## Scope

The owner-approved final-wave Q1-Q12 matrix remains separate. No source assertion, paid-operation guard, image hash or provenance check was weakened. The product placement defect above remains assigned to todo 04. Model/harness: GPT coding agent in Senpi; shared packaged-Electron HIG runner.

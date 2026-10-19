## Problem and change

Follow-up to independent QA: the previous 36x36 boxes had rounded, smaller actual pointer targets. A transparent square `::after` now covers each touched icon button, including its border, without changing its rounded paint or extending past its bounding box. Native icon buttons are positioned anchors; the send artwork retains its own rounded clipping.

Touched icon controls retained compact 20-32px hit boxes, including disabled Send and shared dialog Close. Owned icon buttons now use a shared 36x36 CSS-pixel minimum, including disabled and pressed states, without press-scale shrink. Send/Stop stay 36px at desktop breakpoints; preview chrome/address spacing accommodates the larger controls. Case 02 rejects undersized targets in capture geometry and live portal consumers.

Closes: W-27, W-28, W-29. Base: `ef605dbd4c71c88b8229f4bce0283890cc91d9a4`. Head: `f49c15848e37cecf12024abcd7a65617614b42ff`.
app.asar SHA-256: `2c5d1f06efc60074f3fb5b605d7e2607faa579027822b8c2cfbd6202ea302a23`.
Dependency: #73. The test-only parent update extends shared runner 71710424. Both sides were freshly recaptured; the identical parent app sources permit reuse of the explicitly identified parent package (appRevision `bb7649c97402d9a853f91b3a987f9fa48aa970eb`). The approved MessagesTimeline amendment remains limited to failedToolIconClassName.

## Verification

Build, extract, both captures, diff, measure-02, motion-02, accept_pr 02 and independent --verify-packet: **exit 0**. Seven packaged checks passed (611 assertions), plus 44 harness tests and 1 existing sidebar test. Targeted lint/fmt and web typecheck exited 0; existing warnings on untouched lines remain. All 158 primary and 26 supplemental pairs have matching dimensions and zero diff failures.

All 18 observed touched icon identities measure 36x36 CSS px. Disabled Send/Back/Forward/Refresh are included. Intersections between touched targets, including disabled boxes, are zero; no new overlap with other hittable controls. The [refreshed evidence branch](https://github.com/kjg8619/Weavra/tree/hig-evidence/02/02) records this head and app.asar instead of fdc8ffc0; hit-controls.json contains raw rectangles and logs contain exact command receipts.

| Control | After CSS px | Disabled observed |
|---|---|---|
| Toggle main sidebar | 36x36 | false |
| Dismiss notification | 36x36 | false |
| 파일 첨부 | 36x36 | false |
| 메시지 보내기 | 36x36 | true |
| Close | 36x36 | false |
| Back | 36x36 | true |
| Forward | 36x36 | true |
| Refresh | 36x36 | true |
| Open in system browser | 36x36 | false |
| Annotate preview | 36x36 | false |
| Capture screenshot | 36x36 | false |
| Float preview over chat | 36x36 | false |
| 생성 중지 | 36x36 | false |
| 이전 미디어 | 36x36 | false |
| image 미리보기 닫기 | 36x36 | false |
| 다음 미디어 | 36x36 | false |
| Minimize the theme editor | 36x36 | false |
| Close the theme editor | 36x36 | false |

### Strict five-point hit evidence

All 157 eligible capture/live observations hit the control at the center and all four corners inset 4 CSS px. The check uses document.elementFromPoint equality/containment. Disabled and center-obscured/modal-inert controls are excluded exactly as independent QA did; their size requirements remain enforced. A harness test proves that one missed corner fails case 02. The previous packet reproduces all four reported failures (hit-baseline.json).

| State | Control | x,y,w,h | Center + four corners |
|---|---|---|---|
| 1280x800/04_empty_projects.png | Dismiss notification | 1217,79,36,36 | true,true,true,true,true |
| 1280x800/37_chat_streaming_working.png | 생성 중지 | 1099,727,36,36 | true,true,true,true,true |
| 1920x1080/04_empty_projects.png | Dismiss notification | 1857,79,36,36 | true,true,true,true,true |
| 1920x1080/37_chat_streaming_working.png | 생성 중지 | 1419,1007,36,36 | true,true,true,true,true |

## Before / after

All 184 paired rows and 49 after-only scenario frames follow. State/size/theme/interaction identifiers map to full filenames and SHA-256 values in publication-index.json. Ratio / HS means diffRatio / hotspot count; no global similarity threshold or UI mask is used. Located changes are icon geometry, semantic layers and explicit motion/color contracts; fixture-age and spinner differences remain unmasked.

| State, size, theme, interaction | Before | After | Ratio / HS |
|---|---|---|---|
| `1280x800/01` | ![B](https://github.com/user-attachments/assets/c93ec48b-0c3a-400e-a06a-3700f0add943) | ![A](https://github.com/user-attachments/assets/fb3129de-5945-49c7-9013-577d2db2bd75) | 0.0024 / 4 |
| `1280x800/02` | ![B](https://github.com/user-attachments/assets/35a4e67d-5f5b-4691-a904-7c204b746e08) | ![A](https://github.com/user-attachments/assets/58dca760-18e0-4c32-b4d6-f9748f625457) | 0.0024 / 5 |
| `1280x800/03` | ![B](https://github.com/user-attachments/assets/ad1cc939-53bc-47aa-a091-e18057df74db) | ![A](https://github.com/user-attachments/assets/2369bd35-d8fe-4cb5-b3dc-4a17273ef076) | 0.0024 / 2 |
| `1280x800/04` | ![B](https://github.com/user-attachments/assets/98e21f94-0b9a-4f74-861e-481e29772ec1) | ![A](https://github.com/user-attachments/assets/bbc1c4da-22ee-4fd1-9027-b0ef431a8e58) | 0.0017 / 4 |
| `1280x800/05` | ![B](https://github.com/user-attachments/assets/417dad28-1913-4df4-84dd-3b4c68a11371) | ![A](https://github.com/user-attachments/assets/6dc208aa-f138-4558-b57b-2cf61df45ef2) | 0.0657 / 11 |
| `1280x800/06` | ![B](https://github.com/user-attachments/assets/3dd96fe1-4650-43ba-804c-9b8e181afa2c) | ![A](https://github.com/user-attachments/assets/cc6834f7-75c4-47ac-96c2-b8347dd992db) | 0.0667 / 15 |
| `1280x800/07` | ![B](https://github.com/user-attachments/assets/2b631f45-60ff-4ac8-ba0f-a979df11c5e1) | ![A](https://github.com/user-attachments/assets/908a96a3-19d4-4d40-adff-97b006ba9c78) | 0.0340 / 24 |
| `1280x800/08` | ![B](https://github.com/user-attachments/assets/8122d2a5-07ed-424b-9eb4-116c8a63d142) | ![A](https://github.com/user-attachments/assets/88696e33-a69e-40a6-add0-9fdf46d4acc9) | 0.0447 / 24 |
| `1280x800/09` | ![B](https://github.com/user-attachments/assets/43864971-c906-4d55-991b-1703b5bf3482) | ![A](https://github.com/user-attachments/assets/2893e7f2-655e-498d-8dab-87599e25dd9b) | 0.0240 / 18 |
| `1280x800/10` | ![B](https://github.com/user-attachments/assets/cbf35282-d544-4159-bc4f-4321020ae5fa) | ![A](https://github.com/user-attachments/assets/260e24e3-e96f-4680-9246-262bdff34670) | 0.0240 / 18 |
| `1280x800/11` | ![B](https://github.com/user-attachments/assets/f8488aa5-5fa7-479a-9a3c-aaf3139bbbb1) | ![A](https://github.com/user-attachments/assets/ac07c69b-bb5e-46d1-ba0d-97dfc538bfbc) | 0.0183 / 18 |
| `1280x800/12` | ![B](https://github.com/user-attachments/assets/0d80eca5-a726-4690-8d57-55d5a61f3cd1) | ![A](https://github.com/user-attachments/assets/12a1ed5a-696b-4bdf-bc41-49c5096cbdd0) | 0.0240 / 18 |
| `1280x800/13` | ![B](https://github.com/user-attachments/assets/039e5709-15b7-409b-aa6a-d7ac2bd07432) | ![A](https://github.com/user-attachments/assets/0992d9c8-0700-4905-8a92-9b5ef5fdca98) | 0.0240 / 18 |
| `1280x800/14` | ![B](https://github.com/user-attachments/assets/3d38d809-d033-42fc-9738-f7e9eda81fb3) | ![A](https://github.com/user-attachments/assets/f3b33be4-e788-4366-a4ab-0c8e2cbf4677) | 0.0158 / 17 |
| `1280x800/15` | ![B](https://github.com/user-attachments/assets/d8318d10-0b7f-4a1b-85eb-1b3ada3ae593) | ![A](https://github.com/user-attachments/assets/77dde72d-d058-452a-b461-fd766855810b) | 0.0413 / 29 |
| `1280x800/16` | ![B](https://github.com/user-attachments/assets/2518e6f4-73a6-4847-a5bf-052cf84c0e21) | ![A](https://github.com/user-attachments/assets/d265b3ba-f5d4-49cd-91b2-0a4d9ddbd5d7) | 0.0240 / 18 |
| `1280x800/17` | ![B](https://github.com/user-attachments/assets/751dd8b7-54eb-49ca-9eb3-b4af68d1fc7d) | ![A](https://github.com/user-attachments/assets/da83a26c-c44e-4edf-8cf9-4d00d0d2d826) | 0.0007 / 3 |
| `1280x800/18` | ![B](https://github.com/user-attachments/assets/f3cdcd5b-ae56-4282-82a4-c98aaf201ebb) | ![A](https://github.com/user-attachments/assets/5caba89c-388f-42a2-ac51-0a85faf05a24) | 0.0010 / 14 |
| `1280x800/19` | ![B](https://github.com/user-attachments/assets/2adf3f4e-90d7-488f-9f4d-0ef7d48d02a3) | ![A](https://github.com/user-attachments/assets/f072ac3c-d997-45d6-a3fd-0a72b21b7224) | 0.0010 / 16 |
| `1280x800/20` | ![B](https://github.com/user-attachments/assets/10840e63-a5f8-48e9-a65c-bc060607c925) | ![A](https://github.com/user-attachments/assets/6d4d44b3-be8d-4260-a40b-f1609e0016c2) | 0.0007 / 2 |
| `1280x800/21` | ![B](https://github.com/user-attachments/assets/81ff0d01-95ff-4cc4-945c-d7eeea91e93f) | ![A](https://github.com/user-attachments/assets/e2593f3b-3c45-43cc-b2c7-a8f96ecb27fc) | 0.0007 / 2 |
| `1280x800/22` | ![B](https://github.com/user-attachments/assets/d293dff9-8ebf-4217-9617-001e14b67cb6) | ![A](https://github.com/user-attachments/assets/29410d0f-2544-4b73-a16f-684aea94cc07) | 0.0007 / 2 |
| `1280x800/23` | ![B](https://github.com/user-attachments/assets/2c3a031c-dd01-4688-b813-e25e40414141) | ![A](https://github.com/user-attachments/assets/021e2025-903f-4afb-a9c5-b07907ff93ad) | 0.0007 / 2 |
| `1280x800/24` | ![B](https://github.com/user-attachments/assets/1608df6d-862e-4dbb-874d-f8b55b3239e4) | ![A](https://github.com/user-attachments/assets/2b394d28-a873-4335-85fa-4f05c4b920f8) | 0.0007 / 2 |
| `1280x800/25` | ![B](https://github.com/user-attachments/assets/636ce009-f632-4ae8-bafd-a154e505d567) | ![A](https://github.com/user-attachments/assets/33b5557b-98b1-44d1-8af7-53c6069c68e4) | 0.0007 / 2 |
| `1280x800/26` | ![B](https://github.com/user-attachments/assets/9266f296-07e3-415f-9587-91fe2e5710ae) | ![A](https://github.com/user-attachments/assets/d5d70d41-fff1-44d9-b908-670a0e01d34f) | 0.0044 / 10 |
| `1280x800/27` | ![B](https://github.com/user-attachments/assets/071a9173-8a2d-46fa-bb0e-0627943875d9) | ![A](https://github.com/user-attachments/assets/90916bce-e353-42e4-8d5d-d155c4ecee79) | 0.0007 / 2 |
| `1280x800/28` | ![B](https://github.com/user-attachments/assets/17dfeb92-5939-437a-b1f7-3704fcfa0fe3) | ![A](https://github.com/user-attachments/assets/8df83eee-bd95-4ac6-b951-841895353ceb) | 0.0007 / 2 |
| `1280x800/29` | ![B](https://github.com/user-attachments/assets/468c6a86-29e9-47e5-9a05-7252ed298aee) | ![A](https://github.com/user-attachments/assets/9987c2ce-3b19-4148-95fe-916dddf8430a) | 0.0043 / 20 |
| `1280x800/30` | ![B](https://github.com/user-attachments/assets/f79d6dd3-8b68-4019-87c2-f2da19395f81) | ![A](https://github.com/user-attachments/assets/5b10915f-1445-4093-8ca4-f8d78256d370) | 0.0007 / 2 |
| `1280x800/31` | ![B](https://github.com/user-attachments/assets/630a9fe6-143b-4d46-b07f-2effb3653aba) | ![A](https://github.com/user-attachments/assets/db14b719-4588-457c-a205-70ef45271203) | 0.0359 / 24 |
| `1280x800/32` | ![B](https://github.com/user-attachments/assets/7b48d559-08be-43b2-a0bb-f1e966118155) | ![A](https://github.com/user-attachments/assets/d8cf4f53-9821-47e5-9274-3548fb831843) | 0.0279 / 24 |
| `1280x800/33` | ![B](https://github.com/user-attachments/assets/7a95422d-01e0-45b9-9378-75bc825a9b43) | ![A](https://github.com/user-attachments/assets/e3b6063f-256f-4980-b6d3-619c77d5ebeb) | 0.0341 / 25 |
| `1280x800/34` | ![B](https://github.com/user-attachments/assets/5900e77e-6414-4fc6-80dc-7253dd3a6215) | ![A](https://github.com/user-attachments/assets/bbd89b50-6f7a-427e-af72-9f7228b0a9f6) | 0.0154 / 14 |
| `1280x800/35` | ![B](https://github.com/user-attachments/assets/372f1f68-759e-42ac-8331-3cef1a14101d) | ![A](https://github.com/user-attachments/assets/368a45ef-8895-4de5-a273-70f1db8f99ba) | 0.0645 / 41 |
| `1280x800/36` | ![B](https://github.com/user-attachments/assets/695f31b6-9ca6-4a08-8908-c4e3c87139e0) | ![A](https://github.com/user-attachments/assets/21ea14bc-408a-4f14-9269-73543ccaddb0) | 0.0516 / 46 |
| `1280x800/36 native` | ![B](https://github.com/user-attachments/assets/7d2a20c1-8006-4f69-94ac-bb6478a69650) | ![A](https://github.com/user-attachments/assets/f95db7c9-9b85-4fcd-a794-4c757d1a589d) | 0.0459 / 46 |
| `1280x800/37` | ![B](https://github.com/user-attachments/assets/cf5aafe9-e980-4a6a-9fd6-478ac941aa95) | ![A](https://github.com/user-attachments/assets/2412afe9-9971-4714-b9d7-abe942ee92f4) | 0.0154 / 15 |
| `1280x800/38` | ![B](https://github.com/user-attachments/assets/68dbd961-b82c-4376-975a-9a6960a954c8) | ![A](https://github.com/user-attachments/assets/bcd66b3c-0d25-4a8c-9ead-c45d72d7e918) | 0.0132 / 14 |
| `1280x800/39` | ![B](https://github.com/user-attachments/assets/6f16dca2-4ba7-4cdf-b6e9-cd1a91923fd0) | ![A](https://github.com/user-attachments/assets/55840b30-8ede-44ab-9bb1-ed37fb7c8fce) | 0.0169 / 16 |
| `1280x800/40` | ![B](https://github.com/user-attachments/assets/ca7a6953-295f-4f58-bae4-3bfceb821288) | ![A](https://github.com/user-attachments/assets/92ccc340-4736-426b-9654-ab24fdd89d56) | 0.0133 / 13 |
| `1280x800/41` | ![B](https://github.com/user-attachments/assets/a4b1e9a1-aeec-42e4-bda9-f681f3866a25) | ![A](https://github.com/user-attachments/assets/67df1d0d-53c8-49d5-98ce-94d1ab716872) | 0.0474 / 46 |
| `1280x800/41 native` | ![B](https://github.com/user-attachments/assets/3fed2706-7546-44cc-8b06-43067fdb0a63) | ![A](https://github.com/user-attachments/assets/49ecb674-0ac7-4d97-9e74-e7e7b447de6d) | 0.0415 / 46 |
| `390x844/42` | ![B](https://github.com/user-attachments/assets/89eafede-b4d4-420d-b75f-4c26cf7c37d8) | ![A](https://github.com/user-attachments/assets/19379e15-98d8-48aa-8da4-5b6beba72898) | 0.0094 / 7 |
| `390x844/42 native` | ![B](https://github.com/user-attachments/assets/1795687f-0785-41f4-a52d-061b85637096) | ![A](https://github.com/user-attachments/assets/d13664e3-14a2-4b68-aa91-dfafa35b3e3b) | 0.0084 / 6 |
| `390x844/43` | ![B](https://github.com/user-attachments/assets/088e9043-54b2-4848-a57c-6d0a61521e92) | ![A](https://github.com/user-attachments/assets/6d625e2a-fdd9-468d-bdf4-f274a127afdc) | 0.0434 / 22 |
| `390x844/43 native` | ![B](https://github.com/user-attachments/assets/1d4f2e46-15b4-4a69-92d8-47a2f7d678b3) | ![A](https://github.com/user-attachments/assets/1d41705e-25ec-4e7e-8b69-b1692cf0a0de) | 0.0409 / 21 |
| `1280x800/44` | ![B](https://github.com/user-attachments/assets/7d31a89b-83c7-4afb-a23e-f63abe5d4952) | ![A](https://github.com/user-attachments/assets/9d34a5cf-ea87-4f5c-9f3c-a934dcd207bf) | 0.0810 / 41 |
| `1280x800/45` | ![B](https://github.com/user-attachments/assets/261aa11c-56df-45d9-b377-432ac67aafbd) | ![A](https://github.com/user-attachments/assets/7e3816ee-59bc-4663-915c-844b8808d292) | 0.0526 / 46 |
| `1280x800/46` | ![B](https://github.com/user-attachments/assets/1b99af59-20f9-4dc7-bca8-43022243d37d) | ![A](https://github.com/user-attachments/assets/211824c4-a289-47bd-ac1d-a3bd943fc740) | 0.0070 / 14 |
| `matrix/1280x800/light/46/prepare-end-default` | ![B](https://github.com/user-attachments/assets/147dca4e-8b3d-4f14-aedc-7f41409e5f96) | ![A](https://github.com/user-attachments/assets/ef20ddea-eee8-44af-9ba3-0650986462c6) | 0.0070 / 14 |
| `1280x800/47` | ![B](https://github.com/user-attachments/assets/ab924caf-7e27-4984-87c2-6e7468b0b7b7) | ![A](https://github.com/user-attachments/assets/3ef28e93-71fe-4f8d-974a-3c0a4e987049) | 0.0007 / 2 |
| `1280x800/48` | ![B](https://github.com/user-attachments/assets/4077c47b-3527-43b9-84c2-7d38352de30f) | ![A](https://github.com/user-attachments/assets/39f574b9-964a-42ad-8d18-6c303ff30ca8) | 0.0007 / 2 |
| `matrix/1280x800/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/72387a7d-d734-42e6-9324-e2e30ba178a9) | ![A](https://github.com/user-attachments/assets/33e4b2ff-53f9-45e8-9307-efc22c40e768) | 0.0007 / 2 |
| `matrix/1280x800/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/3533ae33-9800-4e72-94b9-9b29d52f88e3) | ![A](https://github.com/user-attachments/assets/2a56421d-22c3-4771-ae0c-d60179195552) | 0.0070 / 14 |
| `matrix/1280x800/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/ae4d468d-4b01-429c-bdbc-32aa35c47e91) | ![A](https://github.com/user-attachments/assets/92948f09-5c01-4ba3-a47b-ce09fca595fc) | 0.0007 / 2 |
| `matrix/1280x800/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/78c5b5b0-d150-4a1d-83e3-d17036462708) | ![A](https://github.com/user-attachments/assets/5553d064-d8e3-4318-96cd-d6dba704e67f) | 0.0007 / 2 |
| `matrix/1280x800/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/c8bb7350-71f4-4332-a87e-880b97fa256a) | ![A](https://github.com/user-attachments/assets/27d0aa3e-9701-4c44-b51c-05384f4859ee) | 0.0007 / 2 |
| `matrix/1280x800/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/6e86c56c-0984-495c-a009-10e655a30902) | ![A](https://github.com/user-attachments/assets/db0dcd61-131f-4b73-bbee-638bb0046717) | 0.0007 / 2 |
| `matrix/1280x800/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/3edd821d-c276-422e-adeb-3f210a713796) | ![A](https://github.com/user-attachments/assets/00fa438c-8908-4eaa-b4b3-266369c7adac) | 0.0007 / 2 |
| `matrix/1280x800/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/f154eaff-db23-4571-bb06-0779a6e54f91) | ![A](https://github.com/user-attachments/assets/354a8131-7679-485e-af03-bddb4dfbfe3a) | 0.0007 / 2 |
| `matrix/1280x800/light/46/top-default` | ![B](https://github.com/user-attachments/assets/2e4bba9d-6cbd-4e20-a47e-1e9b71a68b47) | ![A](https://github.com/user-attachments/assets/a6c84e67-a575-4422-bcb0-7792a38ed88d) | 0.0070 / 14 |
| `matrix/1280x800/light/46/end-default` | ![B](https://github.com/user-attachments/assets/6dcbb8e4-ce91-4ce8-ad62-c701520f1f62) | ![A](https://github.com/user-attachments/assets/37f4f0d1-316a-4be9-9c6e-8b4d555347ce) | 0.0007 / 2 |
| `matrix/1280x800/light/47/top-default` | ![B](https://github.com/user-attachments/assets/83a7e19b-1589-4e46-b5a5-0c58dc0b185b) | ![A](https://github.com/user-attachments/assets/eb5c8cc0-0eca-4bf2-a8f4-c1df5b66cf11) | 0.0007 / 2 |
| `matrix/1280x800/light/47/end-default` | ![B](https://github.com/user-attachments/assets/c035fb4b-a8e2-4b65-8bbb-951df199ef25) | ![A](https://github.com/user-attachments/assets/ecde17de-0397-427c-8c65-6d76285320b2) | 0.0007 / 2 |
| `matrix/1280x800/light/48/top-default` | ![B](https://github.com/user-attachments/assets/e7665712-e5a1-4d8f-8d7e-fb5e3e5907a2) | ![A](https://github.com/user-attachments/assets/8b549ec5-32d4-47e5-b8a4-cbb97b62fe5d) | 0.0007 / 2 |
| `matrix/1280x800/light/48/end-default` | ![B](https://github.com/user-attachments/assets/32041de1-3e8e-4c9a-97a7-2f47e8e666cb) | ![A](https://github.com/user-attachments/assets/5ddc200c-17ec-4e02-aae0-5732d0b68577) | 0.0007 / 2 |
| `matrix/840x620/light/46/top-default` | ![B](https://github.com/user-attachments/assets/512cb5f0-8ef6-456c-aa4b-0bf4fd98663e) | ![A](https://github.com/user-attachments/assets/0a86f0b5-ea4f-4b31-a2e5-1f1a55048365) | 0.0137 / 8 |
| `matrix/840x620/light/46/end-default` | ![B](https://github.com/user-attachments/assets/09c1aa84-d576-4a28-9f6b-dceca2c4179a) | ![A](https://github.com/user-attachments/assets/7f6649c1-e38b-4fff-8712-865f0e1b5d3e) | 0.0013 / 2 |
| `matrix/840x620/light/47/top-default` | ![B](https://github.com/user-attachments/assets/c8e2284a-f7c8-4d37-b630-82505d542759) | ![A](https://github.com/user-attachments/assets/9fa7398f-e9d2-4842-b50f-12782092aefa) | 0.0013 / 2 |
| `matrix/840x620/light/47/end-default` | ![B](https://github.com/user-attachments/assets/9c144773-8df1-4955-8209-628ec30e181e) | ![A](https://github.com/user-attachments/assets/2078a479-e53c-4a59-807c-897ec4ebd6cf) | 0.0013 / 2 |
| `matrix/840x620/light/48/top-default` | ![B](https://github.com/user-attachments/assets/ba3a3247-20b8-49db-9c34-f5013b3d59ed) | ![A](https://github.com/user-attachments/assets/63bcd2de-2bb0-4507-afa0-de8bc9d42f40) | 0.0013 / 2 |
| `matrix/840x620/light/48/end-default` | ![B](https://github.com/user-attachments/assets/3dd1b0a8-1247-4743-9398-89377ef7bd35) | ![A](https://github.com/user-attachments/assets/0f0899cb-e60e-46ec-8f73-1f134db14cc7) | 0.0013 / 2 |
| `matrix/840x620/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/bced2e0f-52e7-4b5e-aa9a-aab609fb994e) | ![A](https://github.com/user-attachments/assets/6cc09527-83f5-4a07-a485-84c5d5079876) | 0.0013 / 2 |
| `matrix/840x620/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/9ce49e0c-4d4f-4ae5-9fe6-4fd586627c20) | ![A](https://github.com/user-attachments/assets/52b1ed1a-bcf0-4427-8715-ae4b8dce3c64) | 0.0137 / 8 |
| `matrix/840x620/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/68915b2c-60a8-48e6-ad02-ccca74bc68f2) | ![A](https://github.com/user-attachments/assets/05b98a60-0985-46a6-b730-8f9eeca5e076) | 0.0013 / 2 |
| `matrix/840x620/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/412ea590-0c53-4ce8-8996-9f016e68535b) | ![A](https://github.com/user-attachments/assets/00177a2a-0803-4e87-9a22-5391bd7893bf) | 0.0013 / 2 |
| `matrix/840x620/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/649b81d7-9289-4c0e-b2c2-e91683a66e4c) | ![A](https://github.com/user-attachments/assets/830a58c6-39a4-4037-9995-9ef6b58dd02d) | 0.0013 / 2 |
| `matrix/840x620/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/262843ef-8e1a-4a3f-b46f-00d5c968f1c6) | ![A](https://github.com/user-attachments/assets/7997a479-c962-46f3-8268-b9dbca340711) | 0.0013 / 2 |
| `matrix/840x620/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/ee79587d-cb20-4538-851f-3a8fe7d95b3d) | ![A](https://github.com/user-attachments/assets/9c12787f-3735-40e8-939f-e34d00e3d194) | 0.0013 / 2 |
| `matrix/840x620/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/5df35056-99c8-40e0-a19d-3db9483adba2) | ![A](https://github.com/user-attachments/assets/bbe9feb8-652f-4239-bb1f-8a85821c5382) | 0.0013 / 2 |
| `matrix/2560x1440/light/46/top-default` | ![B](https://github.com/user-attachments/assets/b1a7b4b9-7c6e-41f1-b9e1-3f2dcd162c57) | ![A](https://github.com/user-attachments/assets/8d686dbf-55ae-45ad-b0d3-bccaf96192fd) | 0.0020 / 4 |
| `matrix/2560x1440/light/46/end-default` | ![B](https://github.com/user-attachments/assets/6558961e-3d00-4f7f-9123-873e43dceee0) | ![A](https://github.com/user-attachments/assets/d3a1c158-9a2d-4fc1-ab24-972da54d06f1) | 0.0020 / 4 |
| `matrix/2560x1440/light/47/top-default` | ![B](https://github.com/user-attachments/assets/088fe7f3-75be-4ae1-9502-d26795f1bf79) | ![A](https://github.com/user-attachments/assets/7843fde3-89c3-4bc8-98d0-c7a53fdbaa05) | 0.0002 / 1 |
| `matrix/2560x1440/light/47/end-default` | ![B](https://github.com/user-attachments/assets/2abe49ea-41ec-4e21-82fb-99b45a4aa0b6) | ![A](https://github.com/user-attachments/assets/84bdee9a-e04c-4dee-b8ea-881b89f917a2) | 0.0002 / 1 |
| `matrix/2560x1440/light/48/top-default` | ![B](https://github.com/user-attachments/assets/01c8499a-d846-4df4-9e98-bdac99657e2a) | ![A](https://github.com/user-attachments/assets/93e0eb27-ef08-4273-968b-00251bd3a26b) | 0.0002 / 1 |
| `matrix/2560x1440/light/48/end-default` | ![B](https://github.com/user-attachments/assets/55866277-c3c8-4e61-995b-28dcbdee81de) | ![A](https://github.com/user-attachments/assets/99fc0680-f99a-40e2-8750-dce2747f3715) | 0.0002 / 1 |
| `matrix/2560x1440/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/3703b311-9d3e-4928-8e9b-43b087d365a3) | ![A](https://github.com/user-attachments/assets/2f35a282-308f-42fd-8bae-43092836b01c) | 0.0002 / 1 |
| `matrix/2560x1440/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/55a351a6-5ec1-4775-9641-80131f725785) | ![A](https://github.com/user-attachments/assets/fec81ea8-2980-4354-a5ec-a4277319452b) | 0.0020 / 4 |
| `matrix/2560x1440/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/d831eb10-5583-46db-b85c-0b4f43892851) | ![A](https://github.com/user-attachments/assets/62b47585-a177-4e40-bf92-118ead66c5e5) | 0.0020 / 4 |
| `matrix/2560x1440/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/43202fcc-ca0f-4ed7-8a3d-e03cbe6db05d) | ![A](https://github.com/user-attachments/assets/4681adb7-f257-4baa-a089-28ab7231d7f5) | 0.0002 / 1 |
| `matrix/2560x1440/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/a5819f70-42c9-41f4-af7c-97e9a1b0a8b9) | ![A](https://github.com/user-attachments/assets/e2bdf099-b687-4178-b6cd-be66cce196e2) | 0.0002 / 1 |
| `matrix/2560x1440/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/539f9dbc-3cf6-4d01-89c8-c5dd3c1cfe78) | ![A](https://github.com/user-attachments/assets/ba655847-a8c3-420a-bb5d-82915cc65b28) | 0.0002 / 1 |
| `matrix/2560x1440/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/53aac127-323e-43e5-bf69-6ea8e4d72ee1) | ![A](https://github.com/user-attachments/assets/37191853-5141-4242-a33b-dbbde2509409) | 0.0002 / 1 |
| `matrix/2560x1440/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/18771956-0de8-49be-b63d-d3d0f6bd6bf8) | ![A](https://github.com/user-attachments/assets/ab289610-31d5-441e-9f85-f70c850ed2b4) | 0.0002 / 1 |
| `1920x1080/01` | ![B](https://github.com/user-attachments/assets/230ae568-3e15-4fda-b137-30da1d2a4a1d) | ![A](https://github.com/user-attachments/assets/0f2b20e5-7cd5-4f75-a38a-1026dcea1e5d) | 0.0012 / 1 |
| `1920x1080/02` | ![B](https://github.com/user-attachments/assets/2ab44d77-2194-43d6-a293-690557eaece9) | ![A](https://github.com/user-attachments/assets/1a413f74-2509-4c54-8ed9-f3ac4a5227ec) | 0.0012 / 1 |
| `1920x1080/03` | ![B](https://github.com/user-attachments/assets/e37b55ed-d04f-4116-86f4-fe8656f74ce3) | ![A](https://github.com/user-attachments/assets/064ed700-42aa-4577-b399-5ea978877f63) | 0.0012 / 1 |
| `1920x1080/04` | ![B](https://github.com/user-attachments/assets/d96ec7ab-c6f0-4ad7-8da7-dff7bbc94a36) | ![A](https://github.com/user-attachments/assets/1459acde-0715-4f11-9960-ba9f2eb20e56) | 0.0008 / 2 |
| `1920x1080/05` | ![B](https://github.com/user-attachments/assets/d4b047d0-7cd9-4b3e-9a1b-1dc3abca7fa7) | ![A](https://github.com/user-attachments/assets/70818f31-0064-4dd8-9e6d-30f31a7b0fe8) | 0.0327 / 5 |
| `1920x1080/06` | ![B](https://github.com/user-attachments/assets/80d7535c-b370-400a-b2fa-5edba37ce344) | ![A](https://github.com/user-attachments/assets/49e9bb8f-9c6d-46e9-8702-74cc18e30a8b) | 0.0332 / 9 |
| `1920x1080/07` | ![B](https://github.com/user-attachments/assets/4edbcf5a-43eb-492c-8fdd-6902409d2fb8) | ![A](https://github.com/user-attachments/assets/48329726-ea12-4d63-8523-5cf6772d20f4) | 0.0168 / 11 |
| `1920x1080/08` | ![B](https://github.com/user-attachments/assets/36c5cc44-edba-4886-af0e-7b36a732319c) | ![A](https://github.com/user-attachments/assets/171e9413-fcff-42c9-8df2-9fcc31dc0667) | 0.0221 / 11 |
| `1920x1080/09` | ![B](https://github.com/user-attachments/assets/f5f95203-239a-4852-aa41-b62cd741ad27) | ![A](https://github.com/user-attachments/assets/30be74e9-0e96-4da7-a7eb-06bd2f6b0093) | 0.0168 / 11 |
| `1920x1080/10` | ![B](https://github.com/user-attachments/assets/1a0d6276-a8ac-45a6-87ed-c627b500a8ce) | ![A](https://github.com/user-attachments/assets/90107750-7030-4218-a45a-21fa6972eb61) | 0.0168 / 11 |
| `1920x1080/11` | ![B](https://github.com/user-attachments/assets/b8ab9122-1cca-410b-8527-306ee86fd1da) | ![A](https://github.com/user-attachments/assets/856b841f-d561-4762-a1e2-3230bea96661) | 0.0141 / 14 |
| `1920x1080/12` | ![B](https://github.com/user-attachments/assets/74a1a96a-a662-4d16-b24d-8780c836ab00) | ![A](https://github.com/user-attachments/assets/526685ad-f2ad-4b26-ad7c-c9365d910f47) | 0.0168 / 11 |
| `1920x1080/13` | ![B](https://github.com/user-attachments/assets/ff71e896-3686-49ee-a35c-857370aa3d92) | ![A](https://github.com/user-attachments/assets/aace9c62-b223-4d89-a41e-b9f0c7b29d0b) | 0.0168 / 11 |
| `1920x1080/14` | ![B](https://github.com/user-attachments/assets/e46dddb2-26b2-44f5-b84d-1ee224384aab) | ![A](https://github.com/user-attachments/assets/c505e0da-51e4-4f1c-b799-f83d35346fcf) | 0.0117 / 14 |
| `1920x1080/15` | ![B](https://github.com/user-attachments/assets/d0f00dfe-1965-40d7-990e-72bc4110bcd5) | ![A](https://github.com/user-attachments/assets/500d0562-05d8-410b-a9ac-0f016ef7186e) | 0.0253 / 18 |
| `1920x1080/16` | ![B](https://github.com/user-attachments/assets/750669df-f4df-49b2-8b35-736717cf29d1) | ![A](https://github.com/user-attachments/assets/6594ee6a-272c-41cc-bdac-79af6d169f92) | 0.0168 / 11 |
| `1920x1080/17` | ![B](https://github.com/user-attachments/assets/2eb01aeb-0add-489d-951d-2d3e9b642fdb) | ![A](https://github.com/user-attachments/assets/bb315c0d-1af2-438d-8c4a-5eee36304c5b) | 0.0003 / 1 |
| `1920x1080/18` | ![B](https://github.com/user-attachments/assets/17246a8a-4331-433f-80e3-59e389dd163e) | ![A](https://github.com/user-attachments/assets/eb85757a-1b95-49f5-a401-993c2f443a06) | 0.0005 / 11 |
| `1920x1080/19` | ![B](https://github.com/user-attachments/assets/bcc05542-dc2e-429b-87df-a56213c541f3) | ![A](https://github.com/user-attachments/assets/d264dec3-be1f-4b4e-af48-a8b151bf5fd6) | 0.0005 / 15 |
| `1920x1080/20` | ![B](https://github.com/user-attachments/assets/c313c34c-78a8-4034-ae83-1cf910d3f6f1) | ![A](https://github.com/user-attachments/assets/3ec459f1-4746-4ea6-beef-7fb59f9aad11) | 0.0003 / 1 |
| `1920x1080/21` | ![B](https://github.com/user-attachments/assets/f70ae003-494c-40f5-8d7f-806c14d2b9cf) | ![A](https://github.com/user-attachments/assets/8136362f-9162-40a3-92e7-40861c3cc9df) | 0.0003 / 1 |
| `1920x1080/22` | ![B](https://github.com/user-attachments/assets/dd0f028a-7c44-486d-8864-36ae8dd7ceeb) | ![A](https://github.com/user-attachments/assets/6a60275c-5556-4ecc-adb7-369243a3d468) | 0.0003 / 1 |
| `1920x1080/23` | ![B](https://github.com/user-attachments/assets/82af9567-8048-45cb-9b82-541379d4daf8) | ![A](https://github.com/user-attachments/assets/c72d9c0a-e360-44d5-91cb-afec1a9a5017) | 0.0003 / 1 |
| `1920x1080/24` | ![B](https://github.com/user-attachments/assets/0221a2ae-b537-4d57-b76b-709b5820d46e) | ![A](https://github.com/user-attachments/assets/cc75c6b7-29ad-4663-86d8-ae8cd3ce4e35) | 0.0003 / 1 |
| `1920x1080/25` | ![B](https://github.com/user-attachments/assets/f03ef5fe-c128-43c9-80e1-5ba1d3d5fd1e) | ![A](https://github.com/user-attachments/assets/72604ec1-ccc5-4895-8a7e-48ded9c0d5eb) | 0.0003 / 1 |
| `1920x1080/26` | ![B](https://github.com/user-attachments/assets/0c531fdf-67c3-4c94-a1a6-de2564f4b39e) | ![A](https://github.com/user-attachments/assets/f03558cd-52f3-4564-ba77-9bb5c33f1196) | 0.0003 / 1 |
| `1920x1080/27` | ![B](https://github.com/user-attachments/assets/a55289f2-3bff-43c8-b722-bdf32932b1e1) | ![A](https://github.com/user-attachments/assets/70cb1688-03d0-47a0-983a-d3f2e7fc3310) | 0.0003 / 1 |
| `1920x1080/28` | ![B](https://github.com/user-attachments/assets/20f1a7e2-b00c-4ba0-af5e-81d4cdca1355) | ![A](https://github.com/user-attachments/assets/ad47947e-fa74-4de4-962c-9a3d54c774ed) | 0.0003 / 1 |
| `1920x1080/29` | ![B](https://github.com/user-attachments/assets/3734f57b-486c-45da-bbb7-76a132db8cc8) | ![A](https://github.com/user-attachments/assets/cccee0e6-951e-4b94-b452-70ccf560dc46) | 0.0036 / 17 |
| `1920x1080/30` | ![B](https://github.com/user-attachments/assets/82a44279-8f83-4821-a1a6-211fc11413ab) | ![A](https://github.com/user-attachments/assets/e801d0e5-a90c-4902-83a0-708f47cce519) | 0.0003 / 1 |
| `1920x1080/31` | ![B](https://github.com/user-attachments/assets/61d3d6be-f97a-46db-ad17-3d38ddefcce3) | ![A](https://github.com/user-attachments/assets/5d174795-0e96-4f4b-8d6b-4a399dc8580c) | 0.0135 / 11 |
| `1920x1080/32` | ![B](https://github.com/user-attachments/assets/0a61d2dd-7893-4045-9f46-c0b747e1ead8) | ![A](https://github.com/user-attachments/assets/71cf8332-7471-435c-9c2e-b0f21b9a706d) | 0.0138 / 11 |
| `1920x1080/33` | ![B](https://github.com/user-attachments/assets/8724a7ec-ee15-4b52-8b32-ef961a462711) | ![A](https://github.com/user-attachments/assets/9ff38fd0-b726-435f-be24-0fd78c491914) | 0.0168 / 12 |
| `1920x1080/34` | ![B](https://github.com/user-attachments/assets/2fbf8ea2-085e-4620-b9bc-f28a5f03ede4) | ![A](https://github.com/user-attachments/assets/bbb6c443-aa22-445a-89ea-f2a93701868e) | 0.0076 / 12 |
| `1920x1080/35` | ![B](https://github.com/user-attachments/assets/614b682d-e8fc-476c-adeb-9abe152b39d8) | ![A](https://github.com/user-attachments/assets/2027f2ca-7594-4960-ba4e-8b3fec2af25d) | 0.0076 / 13 |
| `1920x1080/36` | ![B](https://github.com/user-attachments/assets/ad3cd344-2bc0-4d92-9601-51dff3ae466f) | ![A](https://github.com/user-attachments/assets/0da40613-b528-433a-bbf1-1bde6a53c0d0) | 0.0076 / 12 |
| `1920x1080/36 native` | ![B](https://github.com/user-attachments/assets/945e1fdb-1c86-4d77-994f-4fd324750365) | ![A](https://github.com/user-attachments/assets/04b2a19f-efcd-4fd9-8978-88042c1e33f4) | 0.0067 / 12 |
| `1920x1080/37` | ![B](https://github.com/user-attachments/assets/6ddcfecb-2a4c-4456-804d-0df2d3f882f3) | ![A](https://github.com/user-attachments/assets/5ef085fc-4f53-4ad2-95e4-d0377efba6a6) | 0.0074 / 12 |
| `1920x1080/38` | ![B](https://github.com/user-attachments/assets/66a590b5-570f-4862-a621-43d959edc0b0) | ![A](https://github.com/user-attachments/assets/0cd75921-1c14-499d-b1f2-c3e29bf2a616) | 0.0065 / 12 |
| `1920x1080/39` | ![B](https://github.com/user-attachments/assets/c29d8991-a410-4caf-b31b-8b8763bcce7d) | ![A](https://github.com/user-attachments/assets/cf62d9b4-54e5-48f5-aced-c07aa434e072) | 0.0083 / 13 |
| `1920x1080/40` | ![B](https://github.com/user-attachments/assets/77b8f44e-2e47-4de4-9c86-500cadd827f4) | ![A](https://github.com/user-attachments/assets/b9ed0df1-3258-46f5-b251-ab022fdd4c72) | 0.0083 / 14 |
| `1920x1080/41` | ![B](https://github.com/user-attachments/assets/009ced8e-7391-4912-a83e-9844b4356eef) | ![A](https://github.com/user-attachments/assets/1af3f52f-1944-4583-b28c-8d935ec41097) | 0.0063 / 11 |
| `1920x1080/41 native` | ![B](https://github.com/user-attachments/assets/13396b6d-75ce-43e7-8118-5a1f3acdd7e5) | ![A](https://github.com/user-attachments/assets/5e08e01f-1e7e-405e-ac55-aeceb344bd31) | 0.0055 / 11 |
| `1920x1080/44` | ![B](https://github.com/user-attachments/assets/e2f3cd7d-0f1d-460f-b604-0a2042596fbf) | ![A](https://github.com/user-attachments/assets/b169b19b-104b-44ef-9775-41160fee33b8) | 0.0141 / 13 |
| `1920x1080/45` | ![B](https://github.com/user-attachments/assets/91498dc8-4d72-4815-bb80-e80319c284c0) | ![A](https://github.com/user-attachments/assets/f65cc549-ad5c-4104-a282-df7dd47ef2e6) | 0.0076 / 12 |
| `1920x1080/46` | ![B](https://github.com/user-attachments/assets/e291f044-a3ba-42ae-88ec-69589c388c40) | ![A](https://github.com/user-attachments/assets/2cff7ab5-6b07-4b5d-a0f7-4047573a95c5) | 0.0027 / 5 |
| `matrix/1920x1080/light/46/prepare-end-default` | ![B](https://github.com/user-attachments/assets/121abb9b-f9dc-4e30-9e49-71f9cd13b500) | ![A](https://github.com/user-attachments/assets/dac00b77-36c5-4c25-8381-dc59c845820d) | 0.0027 / 5 |
| `1920x1080/47` | ![B](https://github.com/user-attachments/assets/76bd83c4-1044-4d81-bf98-336aa7a14198) | ![A](https://github.com/user-attachments/assets/89466d05-55bd-4160-8117-1797b2dc4ac3) | 0.0003 / 1 |
| `1920x1080/48` | ![B](https://github.com/user-attachments/assets/9acd2fa4-e15e-46db-8ff3-cbb7855ca0fd) | ![A](https://github.com/user-attachments/assets/aa445ee9-e372-4929-b920-43ff6e66f2d0) | 0.0003 / 1 |
| `matrix/1920x1080/light/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/b27cbecb-685b-4ed1-92ba-6a586dc669c4) | ![A](https://github.com/user-attachments/assets/619b5a68-b847-4284-bfce-3dc4fdedcde8) | 0.0003 / 1 |
| `matrix/1920x1080/dark/46/top-default` | ![B](https://github.com/user-attachments/assets/490da81b-5871-4398-8309-28b98950cb27) | ![A](https://github.com/user-attachments/assets/493ed991-8d43-4ecb-849b-054fb737f40d) | 0.0027 / 5 |
| `matrix/1920x1080/dark/46/end-default` | ![B](https://github.com/user-attachments/assets/6e14cbd4-c1e9-4b24-9625-dc15f032d0ca) | ![A](https://github.com/user-attachments/assets/b0b2cefb-b76d-4423-a358-eef97fc877da) | 0.0027 / 9 |
| `matrix/1920x1080/dark/47/top-default` | ![B](https://github.com/user-attachments/assets/28a3cc37-8b4a-472a-8cd9-3c7d117faf27) | ![A](https://github.com/user-attachments/assets/2de74f72-d844-4457-bc93-b463925aeb55) | 0.0003 / 1 |
| `matrix/1920x1080/dark/47/end-default` | ![B](https://github.com/user-attachments/assets/e6326c7c-a565-4a07-873a-d392d1e01e16) | ![A](https://github.com/user-attachments/assets/216bfef1-7e70-4403-a045-dc3f0a45c92f) | 0.0003 / 1 |
| `matrix/1920x1080/dark/48/top-default` | ![B](https://github.com/user-attachments/assets/65f994b9-0c22-4349-b1f6-84ab3d0afead) | ![A](https://github.com/user-attachments/assets/5c674755-3e4d-42f1-b1e8-c64241d53605) | 0.0003 / 1 |
| `matrix/1920x1080/dark/48/end-default` | ![B](https://github.com/user-attachments/assets/e4a4d8e7-1d07-4bd3-9acd-3245a4dbbd63) | ![A](https://github.com/user-attachments/assets/2dfb20e1-208e-4334-8610-20c4c3856ca4) | 0.0003 / 1 |
| `matrix/1920x1080/dark/48/actions-end-default` | ![B](https://github.com/user-attachments/assets/1df54da4-ef86-4fa1-9b8c-e457e26b0499) | ![A](https://github.com/user-attachments/assets/720e97e5-8fb4-4b1a-83af-6ca2928921fd) | 0.0003 / 1 |
| `matrix/1920x1080/light/46/top-default` | ![B](https://github.com/user-attachments/assets/a49f84ce-7a78-4dea-b4ac-16ac0933e001) | ![A](https://github.com/user-attachments/assets/40b0682a-88ed-4df3-98b9-58715de5cca0) | 0.0027 / 15 |
| `matrix/1920x1080/light/46/end-default` | ![B](https://github.com/user-attachments/assets/84cdf5f6-aac6-4d48-906d-109ab4f5981d) | ![A](https://github.com/user-attachments/assets/da8ef39a-7a43-4134-9104-c96f2613c1c4) | 0.0027 / 9 |
| `matrix/1920x1080/light/47/top-default` | ![B](https://github.com/user-attachments/assets/e12077d1-a0d4-4dcc-a2d1-7f1958c3e00d) | ![A](https://github.com/user-attachments/assets/28e76db5-5b0c-49fe-be8c-d583b11760ec) | 0.0003 / 1 |
| `matrix/1920x1080/light/47/end-default` | ![B](https://github.com/user-attachments/assets/9eda474c-08e3-4e4b-be8c-aeaef56d0112) | ![A](https://github.com/user-attachments/assets/54d8bcef-e6e7-40e7-b84b-aa1c7997eec8) | 0.0004 / 6 |
| `matrix/1920x1080/light/48/top-default` | ![B](https://github.com/user-attachments/assets/23200c7b-22fe-4b3d-806d-d119185024d5) | ![A](https://github.com/user-attachments/assets/2305301e-b4e2-4835-b852-86620ac8a586) | 0.0003 / 1 |
| `matrix/1920x1080/light/48/end-default` | ![B](https://github.com/user-attachments/assets/92bf0154-6366-45b4-89a0-ac3be4727e1b) | ![A](https://github.com/user-attachments/assets/3da3e18a-e5fc-4b85-ad52-0975705f23e6) | 0.0003 / 1 |
| `w27/theme-inspector-armed` | ![B](https://github.com/user-attachments/assets/f65b3d05-d739-4918-a89c-d9a324f46bfa) | ![A](https://github.com/user-attachments/assets/6f8bc99a-a68e-4103-947f-04c8ec61b2c0) | 0.5148 / 53 |
| `w27/06-popup-in-dialog` | ![B](https://github.com/user-attachments/assets/f6912840-3963-457d-8458-cc73faa2e7f1) | ![A](https://github.com/user-attachments/assets/3a71ef64-f45d-459a-8a30-f8d35dae9fe6) | 0.0666 / 15 |
| `w27/tooltip` | ![B](https://github.com/user-attachments/assets/55d92cb2-45e1-48fb-85d7-93cdcc2e137c) | ![A](https://github.com/user-attachments/assets/6fb11453-3a7e-4ef0-85be-99c1b15a1749) | 0.0356 / 26 |
| `w27/34-selection-toolbar` | ![B](https://github.com/user-attachments/assets/cab9bf0d-7076-4cb0-a6bd-281ec42d5e26) | ![A](https://github.com/user-attachments/assets/5cc31127-1679-4479-a31f-814c8ba47464) | 0.0171 / 28 |
| `w27/11-popover-in-dialog` | ![B](https://github.com/user-attachments/assets/5ce8279d-0a25-4d01-9b43-867e8cbbdee2) | ![A](https://github.com/user-attachments/assets/be14564b-47c7-44b2-b088-5389b36d54c1) | 0.0721 / 42 |
| `w27/theme-editor-popover` | ![B](https://github.com/user-attachments/assets/ea563517-86b5-4e25-af5d-b49e620e64c8) | ![A](https://github.com/user-attachments/assets/ddd02d55-4f39-4f77-b297-fd79910dfd1b) | 0.0215 / 28 |
| `w27/05-command-palette` | ![B](https://github.com/user-attachments/assets/2053ae78-d960-4ffb-9a2f-d28786c931bf) | ![A](https://github.com/user-attachments/assets/f909fdb8-4d1b-4bbf-8749-cfd5c8a0ef6d) | 0.0657 / 11 |
| `w27/14-dialog` | ![B](https://github.com/user-attachments/assets/9e8053b8-e840-4152-85a6-82d7e841c02d) | ![A](https://github.com/user-attachments/assets/a7029b3d-91d8-4338-a3b4-7adb7c740368) | 0.0823 / 38 |
| `w27/31-model-popup` | ![B](https://github.com/user-attachments/assets/116e803e-56a5-4a15-ac34-ff514b5fed4e) | ![A](https://github.com/user-attachments/assets/f696dd78-7747-46da-8466-9e69e1a65a44) | 0.0365 / 24 |
| `w27/11-add-action-dialog` | ![B](https://github.com/user-attachments/assets/f1f2426f-27a3-4be6-9b44-fafe71cc0df4) | ![A](https://github.com/user-attachments/assets/aa6bdb46-e9a0-4486-9687-8318d389b03a) | 0.0739 / 41 |
| `w29/18-appearance-wireframes-light` | ![B](https://github.com/user-attachments/assets/31c32efe-f70a-4ce4-a973-24944452bcf7) | ![A](https://github.com/user-attachments/assets/7983b019-fa7c-4dbf-adfa-872763c088bf) | 0.0618 / 31 |
| `w29/31-model-popup-dark` | ![B](https://github.com/user-attachments/assets/9abf8226-ac90-43f5-bcfb-494c119a26e6) | ![A](https://github.com/user-attachments/assets/9127d0ff-df86-4c7e-a481-35474af911a7) | 0.0198 / 18 |
| `w29/14-dialog-dark` | ![B](https://github.com/user-attachments/assets/7cb20dd6-ace1-4012-9759-d147acafadab) | ![A](https://github.com/user-attachments/assets/5adda905-3196-4a95-8c49-cac760a33fc6) | 0.0744 / 31 |
| `w29/19-appearance-wireframes-dark` | ![B](https://github.com/user-attachments/assets/e8e0745d-da09-4fc8-949a-e28465879f70) | ![A](https://github.com/user-attachments/assets/8071caae-6143-4e57-8f0c-e49ecc8738c0) | 0.0010 / 14 |
| `motion/dialog-reduced-open-end` | ![B](https://github.com/user-attachments/assets/062fc11c-22af-47e6-ad3e-71d66239172b) | ![A](https://github.com/user-attachments/assets/9f241ca6-3ac6-4aac-8d96-d70bf3034876) | 0.1200 / 52 |
| `motion/dialog-normal-open-mid` | ![B](https://github.com/user-attachments/assets/199579be-edab-44f2-9d04-9c2d83257e55) | ![A](https://github.com/user-attachments/assets/2a91bda0-0fe1-42ff-af18-56ea18620dc2) | 0.2429 / 52 |
| `motion/dialog-normal-open-end` | ![B](https://github.com/user-attachments/assets/dd0a9bb4-bf72-4ef2-8881-1b1f2d18bc5a) | ![A](https://github.com/user-attachments/assets/4b1e0de7-2492-4a20-9b4e-266a7221e888) | 0.0883 / 43 |
| `motion/dialog-reduced-open-mid` | ![B](https://github.com/user-attachments/assets/ea377e71-1724-41c7-b7b8-38330712a0a1) | ![A](https://github.com/user-attachments/assets/831d421a-5b65-4d41-bf7f-a2a4820be606) | 0.4739 / 62 |
| `motion/dialog-normal-open-start` | ![B](https://github.com/user-attachments/assets/f62170af-d1ac-42c9-b67f-e38d564d65a0) | ![A](https://github.com/user-attachments/assets/9302c8a5-ef1a-492b-99bd-d22f632e0997) | 0.0366 / 29 |
| `motion/dialog-reduced-open-start` | ![B](https://github.com/user-attachments/assets/67cd8bc0-5aee-4737-8b6b-8573e9ef414c) | ![A](https://github.com/user-attachments/assets/bef6e1d3-f931-4148-ab68-234aab4d9190) | 0.0694 / 46 |
| `motion/dialog-normal-interrupted` | ![B](https://github.com/user-attachments/assets/8ff6cd1e-0951-4cd4-a6d0-e755e348e036) | ![A](https://github.com/user-attachments/assets/f66de50a-16ff-4aca-bd8c-3c8d34a2b04d) | 0.2429 / 52 |
| `motion/dialog-reduced-interrupted` | ![B](https://github.com/user-attachments/assets/2ec254f5-0eba-44da-9969-bf320449fd19) | ![A](https://github.com/user-attachments/assets/dbc9d78b-f2fc-403b-8720-a459a27ad8bc) | 0.4881 / 60 |
| `w28/sidebar-expand-mid` | ![B](https://github.com/user-attachments/assets/2e8d2614-e7b6-4d85-bdf1-0532c6906c32) | ![A](https://github.com/user-attachments/assets/ca47e168-1e36-4ede-b8a9-09f751f5d88a) | 0.2784 / 41 |
| `w28/sidebar-collapse-mid` | ![B](https://github.com/user-attachments/assets/fa9f5962-5505-4086-9c5a-fe0f6156f798) | ![A](https://github.com/user-attachments/assets/3ef5ca7c-4c3f-4692-9666-4a54ba4516e5) | 0.0858 / 29 |
| `w28/15-browser-pane` | ![B](https://github.com/user-attachments/assets/d1b68d0c-0f68-46c7-8d1f-27f6e621bc1d) | ![A](https://github.com/user-attachments/assets/6654a8ce-ee0f-4d2f-8cdc-8e24d04d4852) | 0.0366 / 29 |
| `w28/sidebar-collapsed` | ![B](https://github.com/user-attachments/assets/c8609563-356e-4868-9882-5509e45b4a17) | ![A](https://github.com/user-attachments/assets/610e7682-d099-4de2-9140-a558b341a1d5) | 0.0362 / 25 |

### Executed scenario frames

| State | After |
|---|---|
| `portal-owner/command-light` | ![A](https://github.com/user-attachments/assets/93246d51-59c2-4603-8dcb-9ec48aa7e5b2) |
| `portal-owner/dialog-light` | ![A](https://github.com/user-attachments/assets/eab54a9c-952c-4cdf-bd4e-347a304fc18d) |
| `portal-owner/modal-child-light` | ![A](https://github.com/user-attachments/assets/860bb350-c2b0-4bc1-a9bc-70b2b1985b70) |
| `portal-owner/model-light` | ![A](https://github.com/user-attachments/assets/8a6b8e77-6b09-4daf-8cbd-a3100b58290f) |
| `portal-owner/select-in-dialog-light` | ![A](https://github.com/user-attachments/assets/872dc7b3-23a1-4166-9ae4-1a71f877fa1d) |
| `portal-owner/image-modal-light` | ![A](https://github.com/user-attachments/assets/4df99c7f-b5a0-465b-9b16-05607cd7d23c) |
| `portal-owner/theme-editor-light` | ![A](https://github.com/user-attachments/assets/242b93af-fb8a-4bb0-9e67-bd4cb8373ffb) |
| `portal-owner/theme-inspector-light` | ![A](https://github.com/user-attachments/assets/ead3a600-0efe-4585-8db5-d37235863a01) |
| `portal-owner/selection-toolbar-light` | ![A](https://github.com/user-attachments/assets/d8314d17-5f68-485a-9ab4-814bd3fed2e5) |
| `portal-owner/tooltip-light` | ![A](https://github.com/user-attachments/assets/52d7123a-49b4-4ff3-be5e-6c80e2f5a3a8) |
| `portal-owner/quit-overlay-light` | ![A](https://github.com/user-attachments/assets/7461f4c1-28a8-4017-8b8f-854fe1c57818) |
| `portal-owner/command-dark` | ![A](https://github.com/user-attachments/assets/07bb1dd1-05d0-401f-997f-7d7a4daf5c6c) |
| `portal-owner/dialog-dark` | ![A](https://github.com/user-attachments/assets/1863a89f-b86a-4374-83c6-14e7c1515720) |
| `portal-owner/modal-child-dark` | ![A](https://github.com/user-attachments/assets/f1160329-dc60-4622-8a55-6af4f544370d) |
| `portal-owner/model-dark` | ![A](https://github.com/user-attachments/assets/176c86e6-1126-4fd6-96fd-a703848a7552) |
| `portal-owner/select-in-dialog-dark` | ![A](https://github.com/user-attachments/assets/aeb1ab62-a320-428c-aba4-83dca8b63df5) |
| `portal-owner/image-modal-dark` | ![A](https://github.com/user-attachments/assets/29fa8782-0c21-48ae-9c1e-e2c4a7f27b9c) |
| `portal-owner/theme-editor-dark` | ![A](https://github.com/user-attachments/assets/ab6adc4b-49b4-4ae9-979b-65e84bf8b1af) |
| `portal-owner/theme-inspector-dark` | ![A](https://github.com/user-attachments/assets/ed741103-bab1-46e8-b0e5-29734e4d2c9c) |
| `portal-owner/selection-toolbar-dark` | ![A](https://github.com/user-attachments/assets/f5002108-8e78-41d0-a596-f587e009579d) |
| `portal-owner/tooltip-dark` | ![A](https://github.com/user-attachments/assets/51d77ec8-11ce-4477-b2c4-2c2c8aa49e2e) |
| `portal-owner/quit-overlay-dark` | ![A](https://github.com/user-attachments/assets/b9f6db53-f6d7-48c4-8457-312d2970c8c2) |
| `portal-owner/result` | ![A](https://github.com/user-attachments/assets/57d2d541-5047-452d-aebf-f82276f1e4d5) |
| `escape-focus-return/child-escape` | ![A](https://github.com/user-attachments/assets/6bf4fb97-e612-49f2-93a5-8e5280c5bd5c) |
| `escape-focus-return/result` | ![A](https://github.com/user-attachments/assets/64a6fcde-2482-4218-b918-8ffb4bcf8b85) |
| `compositor-motion/normal-consumers` | ![A](https://github.com/user-attachments/assets/b6e7b352-4556-4def-b0db-6ced3d93ee00) |
| `compositor-motion/normal-start` | ![A](https://github.com/user-attachments/assets/250292ac-e643-4650-811b-d759777fa63c) |
| `compositor-motion/normal-mid` | ![A](https://github.com/user-attachments/assets/4766b216-9ccb-4118-acec-ccbbcd3160ca) |
| `compositor-motion/normal-end` | ![A](https://github.com/user-attachments/assets/0873dbbf-7baf-4198-a375-41eab12a84c5) |
| `compositor-motion/normal-interrupted` | ![A](https://github.com/user-attachments/assets/af7f8a1f-b9ea-4396-b631-06f41a83880a) |
| `compositor-motion/result` | ![A](https://github.com/user-attachments/assets/252d6b97-f2e2-4670-ab83-505f63b754dd) |
| `reduced-motion/reduced-consumers` | ![A](https://github.com/user-attachments/assets/90ad8f11-21d0-4a52-813c-8c6f4b981bdf) |
| `reduced-motion/reduced-start` | ![A](https://github.com/user-attachments/assets/879fe664-eb4f-495c-a394-73079fb8f584) |
| `reduced-motion/reduced-mid` | ![A](https://github.com/user-attachments/assets/88abd4b3-faed-4c26-b7b9-7c526339eaeb) |
| `reduced-motion/reduced-end` | ![A](https://github.com/user-attachments/assets/4450f861-3885-4dad-b5de-7a679c85b35d) |
| `reduced-motion/reduced-interrupted` | ![A](https://github.com/user-attachments/assets/7596b60d-9717-4590-a6fd-8a30e9905945) |
| `reduced-motion/result` | ![A](https://github.com/user-attachments/assets/0fe063e4-bad1-46e4-8ff5-bd4fec049cae) |
| `semantic-colors/tokens-light` | ![A](https://github.com/user-attachments/assets/6fd161cb-699c-4166-9ada-49a16036d13a) |
| `semantic-colors/tokens-dark` | ![A](https://github.com/user-attachments/assets/6eaba2bf-3e44-4661-a0ab-cbe149dbac97) |
| `semantic-colors/result` | ![A](https://github.com/user-attachments/assets/fb0bb62a-6f63-4bfd-ae9c-8f56c2f4fd4e) |
| `contrast/tool-error-light` | ![A](https://github.com/user-attachments/assets/1235d2de-a1d2-49e3-a6f0-0a1898df4d38) |
| `contrast/dialog-title-light` | ![A](https://github.com/user-attachments/assets/2e73fd6b-d015-4e3d-bda5-8b4670d600f2) |
| `contrast/tooltip-light` | ![A](https://github.com/user-attachments/assets/d20d6048-040b-42fc-8525-26c68615b532) |
| `contrast/tool-error-dark` | ![A](https://github.com/user-attachments/assets/fddf7f87-5a5b-46cd-9284-f3c76124940e) |
| `contrast/dialog-title-dark` | ![A](https://github.com/user-attachments/assets/45d3c7ad-0738-4213-9825-b883f4348c71) |
| `contrast/tooltip-dark` | ![A](https://github.com/user-attachments/assets/760eb232-d4fa-4e99-8eb7-1c08ed69bffb) |
| `contrast/result` | ![A](https://github.com/user-attachments/assets/8cd72c65-57cb-40b7-996c-d7150837907e) |
| `icon-targets/icon-targets` | ![A](https://github.com/user-attachments/assets/0c0626fb-4d48-4f76-bda4-ebe5e7c52566) |
| `icon-targets/result` | ![A](https://github.com/user-attachments/assets/7b05169c-8c65-4c8f-86b0-88aaf8ca0570) |

## Scope and residual findings

No assertion was weakened. Per the owner-approved October 19 plan amendment, this is measurable per-PR acceptance; the exhaustive universal Q1-Q12 matrix runs in the Final verification wave. Text buttons, media thumbnails, resize rails and icons implemented exclusively in unmodified consumer components are not recategorized as touched icon changes. Conditional icon branches use the same minimum contract. Existing lint warnings and typecheck suggestions were not suppressed.

Model and harness: GPT coding agent in Senpi; shared packaged-Electron HIG runner.

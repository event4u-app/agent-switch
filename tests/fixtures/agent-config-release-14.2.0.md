### Release highlights

<!-- Curated head: fill before merge, keep it under 10 lines, and leave `_none_` where it is genuinely the answer. The generated log below is unchanged. -->
- **Behaviour changes:** _none_
- **Default changes + migration:** _none_
- **Security and correctness:** _auto-derived, rewrite before merge:_ security-scoped commits or fixes to executable surface in 61fdf7d, 604632b, c41b89a, 42e8955, cc19737, bbb60a8.
- **Honest nulls:** _none_
- **Known limitations:** _none_

### Features

* **hooks:** stop skill-route pointing at skills the host delivered bare ([508bba9](https://github.com/event4u-app/agent-config/commit/508bba908e074c1c69dc1b36ef2dd679b9e9f1ba))
* **catalogue:** add the delivery reducer the runtime router was missing ([1b65432](https://github.com/event4u-app/agent-config/commit/1b65432d719094b148bc4e30cf328d3e80b3c597))

### Bug Fixes

* **r2:** report the extraction, not the roadmap, and stop truncating criteria ([61fdf7d](https://github.com/event4u-app/agent-config/commit/61fdf7d26f1d9eb634c02451621c573784216bbe))
* **r2:** read inline acceptance criteria, stop faking an empty extraction ([604632b](https://github.com/event4u-app/agent-config/commit/604632b3c991933fb354e3afb50423697489d692))
* **metrics:** name the suppression denominator and register the invisible case ([03fe473](https://github.com/event4u-app/agent-config/commit/03fe4732dabab6b267a8dc1706b4da2a72a74a6d))
* **hooks:** count suppression over the pointer window and pin the envelope wiring ([c41b89a](https://github.com/event4u-app/agent-config/commit/c41b89a1cb21eac3f5e651c4271bd91811a3d66c))
* **catalogue:** let the LATEST record decide the bare set, not the mode filter ([42e8955](https://github.com/event4u-app/agent-config/commit/42e8955148a78314adc3f13cf695ed82e2fe0086))
* **hooks:** let a delete-only push skip the content gates ([cc19737](https://github.com/event4u-app/agent-config/commit/cc197371a66a7b1ee7ddb05ea1a505193434d2b8))
* **ci:** serialize the two publish triggers on the version, not the ref ([bbb60a8](https://github.com/event4u-app/agent-config/commit/bbb60a895b650b1d1e7ce91b49f5ddd025cf00a9))

### Documentation

* **review:** close all six R2 findings and re-bind the artefact ([fe639e5](https://github.com/event4u-app/agent-config/commit/fe639e548109892724b15f4f299132d77658d745))
* **review:** record the R2 findings for the inline-AC fix, all rows open ([5dc1298](https://github.com/event4u-app/agent-config/commit/5dc1298bbc82d3fc7bcd9fe776c56b0be3ce4cd6))
* **review:** re-bind the R2 artefact after the fix pass ([a4b320c](https://github.com/event4u-app/agent-config/commit/a4b320cf371b0828d49799948b0bed94eee6e970))
* **roadmap:** un-checkbox AC-3, make its verify runnable, record what R2 found ([0720e1d](https://github.com/event4u-app/agent-config/commit/0720e1d434bf658dd668bef64ca742897f72594d))
* **review:** bind the R2 completion review for catalogue-host-fit Phase 3 ([1e7b2fd](https://github.com/event4u-app/agent-config/commit/1e7b2fde7ff752f45f907187b61f8f83902a0e75))
* **roadmap:** close catalogue-host-fit Phase 3 and record what its fixture found ([852a8c4](https://github.com/event4u-app/agent-config/commit/852a8c4dbe3a8c9d0b52e7a229460a4d2752d0d3))
* **release:** stop promising an approval checkpoint that does not fire ([7327d2e](https://github.com/event4u-app/agent-config/commit/7327d2ea4aec42e290f951572f972b0f441e563e))

### Chores

* **metrics:** register the bare-suppression rate beside the pointer rate ([707f332](https://github.com/event4u-app/agent-config/commit/707f332a0af8f5d81ff7bf6b73aa46006776422c))

Tests: 14629 (+37 since 14.1.0)

---
**MCP Worker deployed:** `v14.2.0-53e0661` · signature `97ae3079ffe1`
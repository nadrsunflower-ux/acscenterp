// 밖에서 올린 게시물 자동 연결 — 순수 함수 검증 · npm run shorts:test
import test from "node:test";
import assert from "node:assert/strict";
import {
  PAIR_MIN_SIMILARITY,
  externalProjectTitle,
  externalPublicationId,
  isImportablePost,
  pickPartner,
  postTextSimilarity,
  type ExternalPost,
  type PairCandidate,
} from "./external";

const H = 3600_000;
const T0 = Date.parse("2026-11-02T14:00:00Z");

// 1화 실제 문구 (유튜브 제목 · 설명 / 인스타 캡션)
const YT_TITLE = "다이소 신발 정리대를 책상에 걸었더니｜정리템 4가지 8천 원";
const YT_DESC = `이번 주말 다이소에서 건진 정리템 4가지, 다 합쳐 8,000원.

① 섹션케이스 2분할 (2개입 1,000원 · 품번 1026288) — 굴러다니는 건전지 정리
② 실리콘 타이 18cm (10개입 1,000원 · 품번 1050158) — 잘라 버리는 케이블타이 대신
③ 5라인 케이블 홀더 (2개입 1,000원 · 품번 1060066) — 책상에 붙이면 뽑아도 제자리에
④ 걸이형 신발 정리대 (5,000원 · 품번 1069011) — 41~72cm 조절, 책상 상판에 걸어 멀티탭 선반으로

#다이소 #다이소추천템 #정리템 #책상정리 #케이블정리`;
const IG_CAPTION = `다이소 4가지, 다 합쳐 8천 원 🏠
신발 정리대는 신발 말고 책상에 걸어 보세요 — 멀티탭 선반이 됩니다.

① 섹션케이스 2분할 1,000원
② 실리콘 타이 18cm 1,000원
③ 5라인 케이블 홀더 1,000원
④ 걸이형 신발 정리대 5,000원
(2026년 11월 매장 기준)

#다이소 #다이소추천템 #정리템 #책상정리 #살림템`;
const OTHER = "차 안 비상템 3가지 — 무선 핸디 청소기 · 멀티 청소키트 · 세차타월 #다이소 #차량용품";
// 같은 시리즈의 다른 회차 — 「다이소 · 정리템」 이 겹쳐도 같은 영상으로 보면 안 된다
const SERIES = "다이소 주방 정리템 5가지 — 냄비 받침 · 수세미 걸이 #다이소 #정리템";
const SERIES_FULL = "다이소 주방 정리템 5가지, 다 합쳐 7천 원.\n① 냄비 받침 1,000원\n② 수세미 걸이 1,000원\n#다이소 #다이소추천템 #정리템 #주방정리";

const post = (o: Partial<ExternalPost>): ExternalPost => ({ externalId: "x", url: "", title: "", caption: "", publishedAt: T0, thumbnail: "", durationSec: null, privacy: "public", mediaType: "REELS", ...o });
const cand = (id: string, platform: "youtube" | "instagram", at: number, text: string): PairCandidate => ({ publicationId: `pub_${id}`, projectId: `pj_${id}`, platform, at, text });

test("글 겹침 — 같은 영상의 유튜브 · 인스타 문구는 기준을 넘고, 같은 시리즈 다른 회차 · 다른 영상은 못 넘는다", () => {
  const same = postTextSimilarity(`${YT_TITLE}\n${YT_DESC}`, IG_CAPTION);
  assert.ok(same >= PAIR_MIN_SIMILARITY, `같은 영상 ${same}`);
  assert.ok(postTextSimilarity(YT_TITLE, IG_CAPTION) >= PAIR_MIN_SIMILARITY, "유튜브는 제목만 있어도");
  assert.ok(postTextSimilarity(YT_TITLE, SERIES) < PAIR_MIN_SIMILARITY, "같은 시리즈 다른 회차(제목)");
  assert.ok(postTextSimilarity(IG_CAPTION, SERIES_FULL) < PAIR_MIN_SIMILARITY, "같은 시리즈 다른 회차(캡션)");
  assert.ok(postTextSimilarity(`${YT_TITLE}\n${YT_DESC}`, OTHER) < PAIR_MIN_SIMILARITY, "다른 영상");
  assert.equal(postTextSimilarity("다이소 꿀템", IG_CAPTION), 0); // 너무 짧으면 믿지 않는다
  assert.equal(postTextSimilarity("", IG_CAPTION), 0);
});

test("짝 고르기 — 72시간 안 · 다른 플랫폼 · 글이 겹치는 것 / 후보가 하나뿐이고 6시간 안이면 글로 못 가려도", () => {
  const ig = post({ caption: IG_CAPTION, publishedAt: T0 + 2 * H });
  // 유튜브 1화(비슷) · 2화(다름) 가 다 있으면 1화
  const r = pickPartner("instagram", ig, [cand("ep2", "youtube", T0 + 3 * H, OTHER), cand("ep1", "youtube", T0, `${YT_TITLE}\n${YT_DESC}`)]);
  assert.equal(r?.candidate.projectId, "pj_ep1");
  // 같은 시리즈 다른 회차와 1화가 다 있으면 1화 — 다른 회차만 둘 있으면 붙이지 않는다
  assert.equal(pickPartner("instagram", ig, [cand("s", "youtube", T0 + H, SERIES), cand("ep1", "youtube", T0 + 5 * H, `${YT_TITLE}\n${YT_DESC}`)])?.candidate.projectId, "pj_ep1");
  assert.equal(pickPartner("instagram", ig, [cand("s1", "youtube", T0 + H, SERIES), cand("s2", "youtube", T0 + 5 * H, OTHER)]), null);
  // 다른 회차(겹침 0.6대)만 있으면 붙이지 않는다
  assert.equal(pickPartner("instagram", ig, [cand("s1", "youtube", T0 - 40 * H, SERIES_FULL), cand("s2", "youtube", T0 - 50 * H, OTHER)]), null);
  // 같은 플랫폼 · 72시간 밖은 후보가 아니다
  assert.equal(pickPartner("instagram", ig, [cand("a", "instagram", T0, IG_CAPTION)]), null);
  assert.equal(pickPartner("instagram", ig, [cand("b", "youtube", T0 - 80 * H, `${YT_TITLE}\n${YT_DESC}`)]), null);
  // 같은 확인에서 함께 찾은 게시물(pending)이 짝이면 그것을 돌려준다 — 부르는 쪽이 새 영상을 만들고 그쪽이 나중에 붙는다
  const pend = pickPartner("instagram", ig, [cand("lone", "youtube", T0 - 18 * H, OTHER), { ...cand("ep1", "youtube", T0 + 3 * H, `${YT_TITLE}\n${YT_DESC}`), pending: true }]);
  assert.equal(pend?.candidate.pending, true);
  // 따로 올린 다른 영상 하나만 가까이 있으면 — 글이 확실히 다르면 붙이지 않는다
  assert.equal(pickPartner("instagram", post({ caption: IG_CAPTION, publishedAt: T0 + 2 * H }), [cand("lone", "youtube", T0, OTHER)]), null);
  // 글이 짧아 잴 수 없을 때 6시간 안에 후보가 딱 하나면 같은 영상
  assert.equal(pickPartner("instagram", post({ caption: "오늘의 영상", publishedAt: T0 + H }), [cand("c", "youtube", T0, "Daiso haul")])?.candidate.projectId, "pj_c");
  // 후보가 둘이고 글이 다 다르면 붙이지 않는다 (새 영상)
  assert.equal(pickPartner("instagram", post({ caption: "오늘의 영상", publishedAt: T0 + H }), [cand("c", "youtube", T0, "Daiso haul"), cand("d", "youtube", T0 + 2 * H, "car kit")]), null);
  // 하나뿐이어도 6시간 넘게 떨어지면 붙이지 않는다 (하루 전에 따로 올린 영상)
  assert.equal(pickPartner("instagram", post({ caption: "오늘의 영상", publishedAt: T0 + 20 * H }), [cand("c", "youtube", T0, "Daiso haul")]), null);
});

test("연결 대상 · 이름 · 문서 id", () => {
  assert.equal(isImportablePost("youtube", post({ privacy: "public", mediaType: "video" })), true);
  assert.equal(isImportablePost("youtube", post({ privacy: "private", mediaType: "video" })), false); // 예약 · 비공개는 공개되면 그때
  assert.equal(isImportablePost("instagram", post({ mediaType: "REELS" })), true);
  assert.equal(isImportablePost("instagram", post({ mediaType: "IMAGE" })), false);
  assert.equal(isImportablePost("instagram", post({ mediaType: "REELS", publishedAt: 0 })), false);
  assert.equal(externalProjectTitle("youtube", { title: YT_TITLE, caption: "", publishedAt: T0 }), YT_TITLE);
  assert.equal(externalProjectTitle("instagram", { title: "", caption: "#다이소 #살림\n다이소 4가지, 다 합쳐 8천 원 🏠\n둘째 줄", publishedAt: T0 }), "다이소 4가지, 다 합쳐 8천 원 🏠");
  assert.equal(externalProjectTitle("instagram", { title: "", caption: "#다이소", publishedAt: T0 }), "인스타 릴스 11/2");
  assert.equal(externalPublicationId("youtube_UCabc_x1", "dQw4w9WgXcQ"), "ext_youtube_UCabc_x1_dQw4w9WgXcQ");
  assert.match(externalPublicationId("instagram_178_x", "18000000000000001"), /^[\w-]+$/);
});

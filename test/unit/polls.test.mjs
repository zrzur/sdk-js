// Polls: Message.votePoll / unvotePoll / endPoll / fetchPollVoters call the
// poll routes and keep the stored poll; poll events update counts, your own
// choice and the end; the "poll ended" reply is read into its own class.
import assert from "node:assert/strict";
import { test } from "node:test";

import { Client, PollEndedSystemMessage, pollClosed } from "../../lib/solid/index.js";

const ID = (n) => `01ARZ3NDEKTSV4RRFFQ69G5F${n}`;
const ME = ID("AA");
const OTHER = ID("BB");
const C1 = ID("C1");
const M1 = "01ARZ3NDEKTSV4RRFFQ69G5M01";
const M2 = "01ARZ3NDEKTSV4RRFFQ69G5M02";

const readyEvent = {
  type: "Ready",
  users: [{ _id: ME, username: "me", discriminator: "0001", relationship: "User" }],
  servers: [{ _id: ID("SV"), owner: ME, name: "S", channels: [C1], default_permissions: 0 }],
  channels: [{ channel_type: "TextChannel", _id: C1, server: ID("SV"), name: "general" }],
  members: [],
  emojis: [],
};

const future = new Date(Date.now() + 3600_000).toISOString();

const poll = (counts, me, extra = {}) => ({
  question: "Lunch?",
  answers: counts.map((count, i) => ({ id: i + 1, text: `A${i + 1}`, count })),
  expires_at: future,
  me,
  ...extra,
});

async function setup(respond) {
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const request = { method: init?.method ?? "GET", url: String(url), init };
    requests.push(request);
    const body = respond(request);
    return new Response(JSON.stringify(body ?? {}), { status: 200 });
  };
  const client = new Client({ baseURL: "http://localhost:1", autoReconnect: false });
  await client.events.emit("event", readyEvent);
  await client.events.emit("event", {
    type: "Message",
    _id: M1,
    channel: C1,
    author: ME,
    poll: poll([0, 0], []),
  });
  return { client, requests, restore: () => (globalThis.fetch = realFetch) };
}

test("a message carries its poll", async () => {
  const { client, restore } = await setup(() => ({}));
  try {
    const message = client.messages.get(M1);
    assert.equal(message.poll.question, "Lunch?");
    assert.deepEqual(message.poll.me, []);
    assert.equal(message.isPollClosed(), false);
  } finally {
    restore();
  }
});

test("vote, unvote and end call the poll routes and keep the answer", async () => {
  const { client, requests, restore } = await setup((r) => {
    if (r.url.includes("/votes/@me") && r.method === "PUT") return poll([0, 1], [2]);
    if (r.url.includes("/votes/@me") && r.method === "DELETE") return poll([0, 0], []);
    if (r.url.endsWith("/polls/end")) return poll([0, 0], [], { ended: true });
  });
  try {
    const message = client.messages.get(M1);

    await message.votePoll(2);
    const put = requests.find((r) => r.method === "PUT");
    assert.ok(put.url.endsWith(`/channels/${C1}/messages/${M1}/polls/answers/2/votes/@me`));
    assert.deepEqual(message.poll.me, [2]);
    assert.equal(message.poll.answers[1].count, 1);

    await message.unvotePoll(2);
    assert.ok(requests.some((r) => r.method === "DELETE" && r.url.includes("/polls/answers/2/votes/@me")));
    assert.deepEqual(message.poll.me, []);

    await message.endPoll();
    assert.ok(requests.some((r) => r.method === "POST" && r.url.endsWith(`/messages/${M1}/polls/end`)));
    assert.equal(message.isPollClosed(), true);
  } finally {
    restore();
  }
});

test("voters come in vote order with a cursor for the next page", async () => {
  const { client, requests, restore } = await setup((r) => {
    if (r.url.includes("/voters")) {
      return {
        ids: [OTHER, ME],
        users: [
          { _id: ME, username: "me", discriminator: "0001", relationship: "User" },
          { _id: OTHER, username: "other", discriminator: "0002", relationship: "None" },
        ],
        count: 5,
      };
    }
  });
  try {
    const page = await client.messages.get(M1).fetchPollVoters(1, { limit: 2 });
    const get = requests.find((r) => r.url.includes("/voters"));
    assert.ok(get.url.includes(`/messages/${M1}/polls/answers/1/voters`));
    assert.ok(get.url.includes("limit=2"));
    assert.deepEqual(page.users.map((u) => u.id), [OTHER, ME]);
    assert.equal(page.count, 5);
    assert.equal(page.next, ME);
  } finally {
    restore();
  }
});

test("poll events update counts, your choice and the end", async () => {
  const { client, restore } = await setup(() => ({}));
  try {
    const message = client.messages.get(M1);
    let updates = 0;
    client.on("messagePollUpdate", () => updates++);

    await client.events.emit("event", {
      type: "MessagePollVoteAdd",
      id: M1,
      channel_id: C1,
      answer_id: 1,
      answers: [
        { id: 1, count: 3 },
        { id: 2, count: 1 },
      ],
    });
    assert.deepEqual(message.poll.answers.map((a) => a.count), [3, 1]);
    assert.deepEqual(message.poll.me, [], "someone else's vote leaves your choice");

    await client.events.emit("event", {
      type: "MessagePollChoice",
      id: M1,
      channel_id: C1,
      answers: [1],
    });
    assert.deepEqual(message.poll.me, [1]);

    await client.events.emit("event", {
      type: "MessagePollEnd",
      id: M1,
      channel_id: C1,
      answers: [
        { id: 1, count: 4 },
        { id: 2, count: 1 },
      ],
    });
    assert.equal(message.poll.ended, true);
    assert.equal(message.poll.answers[0].count, 4);
    assert.equal(updates, 3);
  } finally {
    restore();
  }
});

test("a poll past its end time is closed", () => {
  assert.equal(pollClosed(poll([0, 0], [], { expires_at: "2020-01-01T00:00:00.000Z" })), true);
  assert.equal(pollClosed(poll([0, 0], [])), false);
  assert.equal(pollClosed(poll([0, 0], [], { ended: true })), true);
});

test("the poll ended reply names the winners", async () => {
  const { client, restore } = await setup(() => ({}));
  try {
    await client.events.emit("event", {
      type: "Message",
      _id: M2,
      channel: C1,
      author: "00000000000000000000000000",
      replies: [M1],
      system: { type: "poll_ended", id: M1, question: "Lunch?", winners: ["A1"], votes: 3, total: 4 },
    });
    const system = client.messages.get(M2).systemMessage;
    assert.ok(system instanceof PollEndedSystemMessage);
    assert.equal(system.messageId, M1);
    assert.deepEqual(system.winners, ["A1"]);
    assert.equal(system.votes, 3);
    assert.equal(system.total, 4);
  } finally {
    restore();
  }
});

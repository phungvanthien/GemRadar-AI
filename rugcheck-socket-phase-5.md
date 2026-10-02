New Tokens
curl -X GET "https://api.rugcheck.xyz/v1/stats/new_tokens"
[
  {
    "mint": "2qAEmRjujrwmyv5p9BVzAKjChD7Tc1cFPQ2C26DQpump",
    "decimals": 6,
    "symbol": "Pickles",
    "creator": "5dqovp3FD2TZSJsqNAGnnVeqyssvEyVxvTU6BFZDu79H",
    "mintAuthority": "",
    "freezeAuthority": "",
    "program": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "createAt": "2025-12-26T10:55:07.513003021Z",
    "updatedAt": "2025-12-26T10:55:07.513054196Z",
    "events": null
  },
  {
    "mint": "3KyhiqZLah1zFyjsWu4AiQ5PLyuvqyiMvFCg7qh1pump",
    "decimals": 6,
    "symbol": "PEPE",
    "creator": "9KQGF4CLE9EwgTbYfHPXEkWQk4MzazC9g1CQbrG2aYwW",
    "mintAuthority": "",
    "freezeAuthority": "",
    "program": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    "createAt": "2025-12-26T10:55:06.261722055Z",
    "updatedAt": "2025-12-26T10:55:06.261761444Z",
    "events": null
  }
]
Most Viewed Tokens
curl -X GET "https://api.rugcheck.xyz/v1/stats/recent"
[
  {
    "mint": "8v6VKJiKCZqQnbrfKqeEnJ6U4DeEtai5ysUEGGfLpump",
    "metadata": {
      "name": "Hollo",
      "symbol": "hollo",
      "uri": "https://ipfs.io/ipfs/bafkreihfehmp7jb7zgjlk2kjg6ugujoveduz6etxlcwiteaz7mxz3tdt2e",
      "mutable": false,
      "updateAuthority": "11111111111111111111111111111111"
    },
    "user_visits": 218,
    "visits": 218,
    "score": 501
  },
  {
    "mint": "WchjLJqbq8AY283hoYKLs7ikBVYbnxUD8aHZf5upump",
    "metadata": {
      "name": "The Krill",
      "symbol": "Krill",
      "uri": "https://metadata.uxento.io/data/335f6c3d-eb0e-47a6-ad22-3c9ac2883a42",
      "mutable": false,
      "updateAuthority": "11111111111111111111111111111111"
    },
    "user_visits": 191,
    "visits": 191,
    "score": 501
  }
]
Trending Tokens
curl -X GET "https://api.rugcheck.xyz/v1/stats/trending"
[
  {
    "mint": "2HAaYt3szziC5KT1kBQ7v5bqgAuLczX3wWRyLhTjpump",
    "vote_count": 1,
    "up_count": 1
  },
  {
    "mint": "39rL8HCHj7nAoG77NnVdkhXy4UpLEfUmVHk1xrA9pump",
    "vote_count": 1,
    "up_count": 1
  },
  {
    "mint": "3CxGFUpMrbGt9ja4H7W14kERwETmyBRTyVSgvUjkpump",
    "vote_count": 1,
    "up_count": 1
  }
]curl -X GET "https://api.rugcheck.xyz/v1/stats/verified"
[
  {
    "mint": "6cNcXWqYvK9nhD1TsjJ1ZH1KATXcaPaRJtZPHyVkJoBs",
    "payer": "FCTkE4h6jV5Mn5LSH3C9LJtjK4CXoXTeDbE5MNVGULMi",
    "name": "x402jobs",
    "symbol": "jobs",
    "description": "Create pay-per-use jobs for agents using x402 resources from anyone",
    "jup_verified": false,
    "jup_strict": false,
    "links": null
  },
  {
    "mint": "EaC6EBUBtNiqZoDEnE3qJ7SDPn6zUzqH6SLzfWWqEVRY",
    "payer": "Btp6PbNEUWx81v3FNUZtofc6iYtUL8qNf2SZn87FCfFw",
    "name": "EVERY",
    "symbol": "every",
    "description": "The Official Token of EVERY.MEME",
    "jup_verified": false,
    "jup_strict": false,
    "links": null
  }
]
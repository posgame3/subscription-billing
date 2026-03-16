/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/subscription_billing.json`.
 */
export type SubscriptionBilling = {
  "address": "B4wwyzi7a7wNrZ3UbisfVJjE436yxuVToB1t5A66ttri",
  "metadata": {
    "name": "subscriptionBilling",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "On-chain subscription billing system — Solana/Anchor"
  },
  "instructions": [
    {
      "name": "cancel",
      "docs": [
        "Cancel a subscription. Status → Cancelled; subscriber keeps access until period_end."
      ],
      "discriminator": [
        232,
        219,
        223,
        41,
        219,
        236,
        220,
        190
      ],
      "accounts": [
        {
          "name": "subscription",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  117,
                  98,
                  115,
                  99,
                  114,
                  105,
                  112,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "plan"
              },
              {
                "kind": "account",
                "path": "subscriber"
              }
            ]
          }
        },
        {
          "name": "plan",
          "relations": [
            "subscription"
          ]
        },
        {
          "name": "subscriber",
          "signer": true,
          "relations": [
            "subscription"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "createPlan",
      "docs": [
        "Create a new subscription plan under the registry."
      ],
      "discriminator": [
        77,
        43,
        141,
        254,
        212,
        118,
        41,
        186
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "plan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "registry"
              },
              {
                "kind": "account",
                "path": "registry.plan_count",
                "account": "serviceRegistry"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true,
          "relations": [
            "registry"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "name",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "priceLamports",
          "type": "u64"
        },
        {
          "name": "periodSeconds",
          "type": "i64"
        },
        {
          "name": "maxSubscribers",
          "type": "u32"
        }
      ]
    },
    {
      "name": "initializeRegistry",
      "docs": [
        "Initialize a new service registry for a provider authority."
      ],
      "discriminator": [
        189,
        181,
        20,
        17,
        174,
        57,
        249,
        59
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "gracePeriodSeconds",
          "type": "i64"
        }
      ]
    },
    {
      "name": "renew",
      "docs": [
        "Renew an existing subscription — pays for the next period.",
        "Can be called when Active (early renewal) or GracePeriod."
      ],
      "discriminator": [
        43,
        239,
        15,
        46,
        27,
        7,
        163,
        73
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "registry.authority",
                "account": "serviceRegistry"
              }
            ]
          },
          "relations": [
            "plan"
          ]
        },
        {
          "name": "plan",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "registry"
              },
              {
                "kind": "account",
                "path": "plan.plan_id",
                "account": "subscriptionPlan"
              }
            ]
          },
          "relations": [
            "subscription"
          ]
        },
        {
          "name": "subscription",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  117,
                  98,
                  115,
                  99,
                  114,
                  105,
                  112,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "plan"
              },
              {
                "kind": "account",
                "path": "subscriber"
              }
            ]
          }
        },
        {
          "name": "payment",
          "docs": [
            "Next payment record — payment_id = subscription.payment_count (before increment)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  121,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "subscription"
              },
              {
                "kind": "account",
                "path": "subscription.payment_count",
                "account": "subscription"
              }
            ]
          }
        },
        {
          "name": "subscriber",
          "writable": true,
          "signer": true,
          "relations": [
            "subscription"
          ]
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "setPlanActive",
      "docs": [
        "Pause or unpause a plan (authority only)."
      ],
      "discriminator": [
        215,
        87,
        208,
        194,
        87,
        65,
        181,
        5
      ],
      "accounts": [
        {
          "name": "registry",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          },
          "relations": [
            "plan"
          ]
        },
        {
          "name": "plan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "registry"
              },
              {
                "kind": "account",
                "path": "plan.plan_id",
                "account": "subscriptionPlan"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "registry"
          ]
        }
      ],
      "args": [
        {
          "name": "isActive",
          "type": "bool"
        }
      ]
    },
    {
      "name": "subscribe",
      "docs": [
        "Subscribe to a plan — transfers first payment immediately."
      ],
      "discriminator": [
        254,
        28,
        191,
        138,
        156,
        179,
        183,
        53
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "registry.authority",
                "account": "serviceRegistry"
              }
            ]
          },
          "relations": [
            "plan"
          ]
        },
        {
          "name": "plan",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "registry"
              },
              {
                "kind": "account",
                "path": "plan.plan_id",
                "account": "subscriptionPlan"
              }
            ]
          }
        },
        {
          "name": "subscription",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  117,
                  98,
                  115,
                  99,
                  114,
                  105,
                  112,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "plan"
              },
              {
                "kind": "account",
                "path": "subscriber"
              }
            ]
          }
        },
        {
          "name": "payment",
          "docs": [
            "First payment record (payment_id = 0)"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  97,
                  121,
                  109,
                  101,
                  110,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "subscription"
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "subscriber",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "tick",
      "docs": [
        "Advance subscription to GracePeriod or Expired based on clock.",
        "Anyone can call this — it's a permissionless state transition."
      ],
      "discriminator": [
        92,
        79,
        44,
        8,
        101,
        80,
        63,
        15
      ],
      "accounts": [
        {
          "name": "registry",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "registry.authority",
                "account": "serviceRegistry"
              }
            ]
          }
        },
        {
          "name": "subscription",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  117,
                  98,
                  115,
                  99,
                  114,
                  105,
                  112,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "plan"
              },
              {
                "kind": "account",
                "path": "subscription.subscriber",
                "account": "subscription"
              }
            ]
          }
        },
        {
          "name": "plan",
          "relations": [
            "subscription"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "withdrawFees",
      "docs": [
        "Authority withdraws accumulated fees from the registry."
      ],
      "discriminator": [
        198,
        212,
        171,
        109,
        144,
        215,
        174,
        89
      ],
      "accounts": [
        {
          "name": "registry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  101,
                  103,
                  105,
                  115,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "authority"
              }
            ]
          }
        },
        {
          "name": "destination",
          "writable": true
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "registry"
          ]
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "paymentRecord",
      "discriminator": [
        202,
        168,
        56,
        249,
        127,
        226,
        86,
        226
      ]
    },
    {
      "name": "serviceRegistry",
      "discriminator": [
        105,
        133,
        96,
        79,
        207,
        176,
        202,
        71
      ]
    },
    {
      "name": "subscription",
      "discriminator": [
        64,
        7,
        26,
        135,
        102,
        132,
        98,
        33
      ]
    },
    {
      "name": "subscriptionPlan",
      "discriminator": [
        157,
        153,
        188,
        46,
        234,
        53,
        172,
        124
      ]
    }
  ],
  "events": [
    {
      "name": "subscriptionCancelled",
      "discriminator": [
        158,
        216,
        233,
        205,
        138,
        62,
        176,
        239
      ]
    },
    {
      "name": "subscriptionCreated",
      "discriminator": [
        215,
        63,
        169,
        25,
        179,
        200,
        180,
        105
      ]
    },
    {
      "name": "subscriptionExpired",
      "discriminator": [
        22,
        7,
        157,
        5,
        79,
        164,
        150,
        39
      ]
    },
    {
      "name": "subscriptionRenewed",
      "discriminator": [
        107,
        68,
        229,
        211,
        63,
        57,
        134,
        149
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "planInactive",
      "msg": "Subscription plan is not active"
    },
    {
      "code": 6001,
      "name": "planAtCapacity",
      "msg": "Subscription plan has reached maximum subscriber capacity"
    },
    {
      "code": 6002,
      "name": "subscriptionNotActive",
      "msg": "Subscription is not active"
    },
    {
      "code": 6003,
      "name": "periodNotEnded",
      "msg": "Subscription period has not yet ended"
    },
    {
      "code": 6004,
      "name": "alreadyCancelled",
      "msg": "Subscription has already been cancelled"
    },
    {
      "code": 6005,
      "name": "subscriptionExpired",
      "msg": "Subscription has expired; please create a new subscription"
    },
    {
      "code": 6006,
      "name": "unauthorized",
      "msg": "Unauthorized: caller is not the registry authority"
    },
    {
      "code": 6007,
      "name": "nameTooLong",
      "msg": "Plan name too long (max 32 bytes)"
    },
    {
      "code": 6008,
      "name": "invalidPeriodDuration",
      "msg": "Invalid period duration (must be > 0)"
    },
    {
      "code": 6009,
      "name": "invalidPrice",
      "msg": "Invalid price (must be > 0)"
    },
    {
      "code": 6010,
      "name": "gracePeriodEnded",
      "msg": "Grace period has ended; subscription is expired"
    },
    {
      "code": 6011,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "paymentRecord",
      "docs": [
        "Immutable ledger entry for each payment.",
        "PDA: [\"payment\", subscription, payment_id as u32 LE bytes]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subscription",
            "type": "pubkey"
          },
          {
            "name": "paymentId",
            "type": "u32"
          },
          {
            "name": "amountLamports",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "periodStart",
            "type": "i64"
          },
          {
            "name": "periodEnd",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "serviceRegistry",
      "docs": [
        "Top-level registry owned by a service provider.",
        "PDA: [\"registry\", authority]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "The authority who can create/pause plans and withdraw fees"
            ],
            "type": "pubkey"
          },
          {
            "name": "planCount",
            "docs": [
              "Running counter used to generate unique plan PDAs"
            ],
            "type": "u64"
          },
          {
            "name": "totalSubscriptions",
            "docs": [
              "Total subscriptions ever created across all plans"
            ],
            "type": "u64"
          },
          {
            "name": "treasuryBalance",
            "docs": [
              "Accumulated protocol fees held in this account (lamports)"
            ],
            "type": "u64"
          },
          {
            "name": "gracePeriodSeconds",
            "docs": [
              "Grace period after billing cycle ends before marking expired (seconds)"
            ],
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "subscription",
      "docs": [
        "One subscriber's subscription to one plan.",
        "PDA: [\"subscription\", plan, subscriber]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "plan",
            "type": "pubkey"
          },
          {
            "name": "subscriber",
            "type": "pubkey"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "subscriptionStatus"
              }
            }
          },
          {
            "name": "currentPeriodStart",
            "docs": [
              "Unix timestamp when the current period started"
            ],
            "type": "i64"
          },
          {
            "name": "currentPeriodEnd",
            "docs": [
              "Unix timestamp when the current period ends"
            ],
            "type": "i64"
          },
          {
            "name": "renewalCount",
            "docs": [
              "Total number of successful renewals (including initial)"
            ],
            "type": "u32"
          },
          {
            "name": "paymentCount",
            "docs": [
              "Total number of payment records"
            ],
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "subscriptionCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subscriber",
            "type": "pubkey"
          },
          {
            "name": "plan",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "subscriptionCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subscriber",
            "type": "pubkey"
          },
          {
            "name": "plan",
            "type": "pubkey"
          },
          {
            "name": "periodEnd",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "subscriptionExpired",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subscriber",
            "type": "pubkey"
          },
          {
            "name": "plan",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "subscriptionPlan",
      "docs": [
        "A billing plan: price + interval, owned by a registry.",
        "PDA: [\"plan\", registry, plan_id as u64 LE bytes]"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "registry",
            "type": "pubkey"
          },
          {
            "name": "planId",
            "type": "u64"
          },
          {
            "name": "name",
            "docs": [
              "Human-readable name (UTF-8, max 32 bytes)"
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "priceLamports",
            "docs": [
              "Cost per billing period in lamports"
            ],
            "type": "u64"
          },
          {
            "name": "periodSeconds",
            "docs": [
              "Length of one billing period in seconds"
            ],
            "type": "i64"
          },
          {
            "name": "maxSubscribers",
            "docs": [
              "0 = unlimited"
            ],
            "type": "u32"
          },
          {
            "name": "subscriberCount",
            "type": "u32"
          },
          {
            "name": "isActive",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "subscriptionRenewed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "subscriber",
            "type": "pubkey"
          },
          {
            "name": "plan",
            "type": "pubkey"
          },
          {
            "name": "newPeriodEnd",
            "type": "i64"
          },
          {
            "name": "renewalCount",
            "type": "u32"
          }
        ]
      }
    },
    {
      "name": "subscriptionStatus",
      "docs": [
        "State machine for a single subscription."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "active"
          },
          {
            "name": "gracePeriod"
          },
          {
            "name": "expired"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    }
  ]
};

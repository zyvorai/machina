// Copyright (c) 2026 ZyvorAI Labs Private Limited. All rights reserved.

use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::mpsc;

use super::{TaskBus, TaskMessage};

pub struct InMemoryTaskBus {
    tx: mpsc::UnboundedSender<TaskMessage>,
}

impl InMemoryTaskBus {
    pub fn new() -> (Arc<Self>, mpsc::UnboundedReceiver<TaskMessage>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Arc::new(Self { tx }), rx)
    }

    pub fn sender(&self) -> mpsc::UnboundedSender<TaskMessage> {
        self.tx.clone()
    }
}

#[async_trait]
impl TaskBus for InMemoryTaskBus {
    async fn publish(&self, _subject: &str, msg: &TaskMessage) -> anyhow::Result<()> {
        self.tx
            .send(msg.clone())
            .map_err(|e| anyhow::anyhow!("task bus send: {e}"))?;
        Ok(())
    }
}

pub struct NatsTaskBus {
    client: async_nats::Client,
}

impl NatsTaskBus {
    pub async fn connect(url: &str) -> anyhow::Result<Arc<Self>> {
        let client = async_nats::connect(url).await?;
        Ok(Arc::new(Self { client }))
    }
}

#[async_trait]
impl TaskBus for NatsTaskBus {
    async fn publish(&self, subject: &str, msg: &TaskMessage) -> anyhow::Result<()> {
        let payload = serde_json::to_vec(msg)?;
        self.client
            .publish(subject.to_string(), payload.into())
            .await?;
        Ok(())
    }
}

pub struct FanoutTaskBus {
    local: Arc<InMemoryTaskBus>,
    nats: Option<Arc<NatsTaskBus>>,
}

impl FanoutTaskBus {
    pub fn new(local: Arc<InMemoryTaskBus>, nats: Option<Arc<NatsTaskBus>>) -> Arc<Self> {
        Arc::new(Self { local, nats })
    }
}

#[async_trait]
impl TaskBus for FanoutTaskBus {
    async fn publish(&self, subject: &str, msg: &TaskMessage) -> anyhow::Result<()> {
        self.local.publish(subject, msg).await?;
        if let Some(nats) = &self.nats {
            let _ = nats.publish(subject, msg).await;
        }
        Ok(())
    }
}

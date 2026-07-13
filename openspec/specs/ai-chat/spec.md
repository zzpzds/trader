# ai-chat Specification

## Purpose
Provide temporary text-only AI chat over the global portfolio using existing strategies, positions, memory notes, and price snapshots.
## Requirements
### Requirement: Global portfolio chat page
The system SHALL provide a Web page for AI chat over the global portfolio.

#### Scenario: User opens the chat page
- **WHEN** the user navigates to the AI Chat entry
- **THEN** the system displays a chat interface with an input area, send control, and message history for the current page session

#### Scenario: Page refresh clears temporary conversation
- **WHEN** the user refreshes or reopens the AI Chat page
- **THEN** the system starts with an empty conversation and does not restore prior chat messages

### Requirement: Text-only portfolio question answering
The system SHALL allow the user to ask global portfolio questions and receive text answers from the configured model.

#### Scenario: User asks a portfolio question
- **WHEN** the user submits a non-empty question
- **THEN** the system sends the question and current page message history to the chat API
- **AND** the system displays the returned text answer in the conversation

#### Scenario: User follows up in the same page session
- **WHEN** the user asks a follow-up question after receiving an answer
- **THEN** the system includes the current page message history so the answer can reference prior turns

### Requirement: Portfolio context injection
The chat API SHALL construct model context from existing portfolio data before calling the model.

#### Scenario: Portfolio data exists
- **WHEN** strategies, open positions, and price snapshots exist in the database
- **THEN** the chat API includes relevant strategy, position, latest available price, and recent price snapshot context in the model request

#### Scenario: Portfolio data is insufficient
- **WHEN** required portfolio context is missing or insufficient for the question
- **THEN** the system returns an answer or error state that explains the data limitation and does not fabricate missing market data

### Requirement: Memory context as bounded background
The chat API SHALL inject only bounded memory context and SHALL present memories as background notes rather than market facts.

#### Scenario: Memories are included in chat context
- **WHEN** pinned, strategy-related, symbol-related, or recent memories are available for the portfolio
- **THEN** the chat API limits the number and total length of injected memories
- **AND** the model context labels memories as user background, preferences, reviews, or notes rather than current market data

#### Scenario: Memory content conflicts with current portfolio data
- **WHEN** injected memory content conflicts with current strategy, position, or price snapshot data
- **THEN** the model answer treats the current portfolio and price snapshot data as more authoritative than memory notes

### Requirement: Trading recommendation support
The chat API SHALL permit the model to provide explicit buy, sell, add, or reduce recommendations when supported by available context.

#### Scenario: Recommendation can be made
- **WHEN** the user asks whether the portfolio should be adjusted and sufficient context exists
- **THEN** the model answer may include explicit buy, sell, add, or reduce recommendations with supporting rationale and risks

#### Scenario: Recommendation lacks data support
- **WHEN** the available context is insufficient to support a specific trading recommendation
- **THEN** the model answer indicates the missing data and avoids presenting unsupported actions as facts

### Requirement: No chat persistence or execution side effects
The system SHALL keep AI Chat conversations temporary and SHALL NOT execute trades or persist chat history.

#### Scenario: Chat response is generated
- **WHEN** the chat API returns an answer
- **THEN** the system does not create chat history records in the database
- **AND** the system does not create, modify, or execute any trade orders

### Requirement: Model configuration and error handling
The system SHALL use Anthropic-compatible model configuration for AI Chat and expose understandable errors when the model cannot be called.

#### Scenario: Chat model configuration is available
- **WHEN** chat-specific or shared Anthropic-compatible environment variables are configured
- **THEN** the chat API uses them to call the model

#### Scenario: Model call fails
- **WHEN** model configuration is missing or the model request fails
- **THEN** the API returns an error response and the UI displays an understandable failure message

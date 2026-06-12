import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QuestionList, type PortalQuestion } from '@/components/portal/QuestionList'

const questions: PortalQuestion[] = [
  { id: '1', order_num: 1, text: 'What is your role?', type: 'single_select', is_open_text: false, is_ai_followup: false, section: 'Screener', answer_options: ['IC', 'Manager'] },
  { id: '2', order_num: 2, text: 'Why did you choose us?', type: 'open_text', is_open_text: true, is_ai_followup: false, section: null, answer_options: [] },
  { id: '3', order_num: 3, text: 'Tell me more about that.', type: 'open_text', is_open_text: true, is_ai_followup: true, section: null, answer_options: [] },
]

describe('QuestionList', () => {
  it('shows all questions by default with counts on the toggle', () => {
    render(<QuestionList questions={questions} />)
    expect(screen.getByText('What is your role?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /all questions \(3\)/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open-text only \(2\)/i })).toBeInTheDocument()
  })

  it('filters to open-text only when toggled', async () => {
    const user = userEvent.setup()
    render(<QuestionList questions={questions} />)
    await user.click(screen.getByRole('button', { name: /open-text only/i }))
    expect(screen.queryByText('What is your role?')).not.toBeInTheDocument()
    expect(screen.getByText('Why did you choose us?')).toBeInTheDocument()
    expect(screen.getByText('Tell me more about that.')).toBeInTheDocument()
  })

  it('tags AI follow-up questions', () => {
    render(<QuestionList questions={questions} />)
    expect(screen.getByText(/ai follow-up/i)).toBeInTheDocument()
  })

  it('shows section headings', () => {
    render(<QuestionList questions={questions} />)
    expect(screen.getByText('Screener')).toBeInTheDocument()
  })
})

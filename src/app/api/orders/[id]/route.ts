import { authenticateBot } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { NextRequest, NextResponse } from 'next/server'

// DELETE - Cancel an order
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const bot = await authenticateBot(request)
  
  if (!bot) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401 }
    )
  }
  
  const { id } = await params
  
  const order = await prisma.order.findUnique({
    where: { id }
  })
  
  if (!order) {
    return NextResponse.json(
      { error: 'Order not found' },
      { status: 404 }
    )
  }
  
  if (order.botId !== bot.id) {
    return NextResponse.json(
      { error: 'You can only cancel your own orders' },
      { status: 403 }
    )
  }
  
  if (order.status !== 'open') {
    return NextResponse.json(
      { error: 'Order is not open' },
      { status: 400 }
    )
  }
  
  await prisma.order.update({
    where: { id },
    data: { status: 'cancelled' }
  })
  
  return NextResponse.json({
    success: true,
    message: 'Order cancelled'
  })
}
